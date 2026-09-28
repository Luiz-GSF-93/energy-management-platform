import {PERMISSIONS as P} from '../../../common/constants/permissions';
import {Injectable,BadRequestException,ConflictException,ForbiddenException,InternalServerErrorException,NotFoundException} from '@nestjs/common';
import {SupabaseService} from '../../../services/supabase.service';
import {LicensesService} from '../../licenses/services/licenses.service';
import {TenantContext} from '../../../common/interfaces/tenant-context.interface';
import {validateWriteDto} from '../../../common/validation/validate-write-dto';
import {CalculationPreparationService} from './preparation.service';
import {SpotReconciliationDto,SpotReconciliationQueryDto} from '../dto/spot-reconciliation.dto';
import {auditAuthorNames} from './audit-author-names';
@Injectable()
export class SpotReconciliationService {
 constructor(private db:SupabaseService,private licenses:LicensesService,private preparation:CalculationPreparationService){}
 private fail(e:any){if(!e)return;if(['P1222','23505'].includes(e.code))throw new ConflictException('Histórico atualizado. Consulte novamente antes de salvar.');if(e.code==='P1221')throw new BadRequestException('Confira documento, competência e justificativa.');throw new InternalServerErrorException('Não foi possível consultar ou salvar a conciliação.');}
 can(t:TenantContext){return t.accessMode==='platform_operation'||['gestor','admin_org'].includes(t.role);}
 async list(input:SpotReconciliationQueryDto,t:TenantContext){
 if(!t.permissions?.includes(P.DOCUMENTS_VIEW)||!t.permissions?.includes(P.ORGANIZATION_CONTRACTS_VIEW))throw new ForbiddenException('Consulta exige acesso a contratos e documentos.');const d=await validateWriteDto(SpotReconciliationQueryDto,input);await this.licenses.requireEntitlement(t.organizationId,'free_market_management');await this.licenses.requireEntitlement(t.organizationId,'document_management');const db=this.db.getClient();
 const c=await db.from('energy_contracts').select('*').eq('organization_id',t.organizationId).eq('id',d.contractId).maybeSingle();this.fail(c.error);if(!c.data||c.data.contract_type!=='ENERGY_PURCHASE')throw new NotFoundException('Contrato indisponível nesta organização.');
 const result=await this.preparation.inspect({consumerUnitId:c.data.consumer_unit_id,month:d.month},t.organizationId);
 const history=await db.from('supplier_spot_reconciliations').select('*').eq('organization_id',t.organizationId).eq('contract_id',d.contractId).eq('month',d.month).order('version',{ascending:false}).range(0,999);this.fail(history.error);if(!Array.isArray(history.data)||history.data.length>=1000)throw new InternalServerErrorException('Histórico indisponível ou extenso.');
 const docs=await db.from('documents').select('id,organization_id,customer_id,consumer_unit_id,energy_contract_id,reference_month,original_filename,file_verified,file_hash').eq('organization_id',t.organizationId).eq('customer_id',c.data.customer_id).eq('consumer_unit_id',c.data.consumer_unit_id).eq('reference_month',d.month+'-01').eq('file_verified',true).order('id').range(0,999);this.fail(docs.error);if(!Array.isArray(docs.data)||docs.data.length>=1000)throw new InternalServerErrorException('Documentos indisponíveis ou consulta extensa.');
 return {contract:c.data,supplier:result.contractSupplierCost,rows:await auditAuthorNames(db,t.organizationId,history.data),documents:docs.data.filter((x:any)=>!x.energy_contract_id||x.energy_contract_id===d.contractId),canConfigure:this.can(t)};
 }
 async create(input:SpotReconciliationDto,t:TenantContext){
 if(!this.can(t)||!t.permissions?.includes(P.ORGANIZATION_CONTRACTS_UPDATE))throw new ForbiddenException('Conciliação exige Gestor ou Administrador.');const d=await validateWriteDto(SpotReconciliationDto,input);if(d.reason.trim().length<20)throw new BadRequestException('Descreva a causa e a conclusão documental.');
 const view=await this.list({contractId:d.contractId,month:d.month},t),r=view.supplier;
 if(!r||r.contract?.id!==d.contractId||!r.reconciliationContext||r.reconciliationContext.hash!==d.sourceHash)throw new ConflictException('As fontes mudaram ou ainda faltam condições, medição ou nota validada. Atualize a consulta.');
 if(d.status==='APPROVED_NO_COST'&&r.requirements.some((x:any)=>x.code!=='SPOT_VOLUME_DIFFERENCE'))throw new BadRequestException('Resolva as demais pendências antes de aprovar a conciliação.');
 const doc=view.documents.find((x:any)=>x.id===d.documentId);if(!doc||!doc.file_hash)throw new BadRequestException('Selecione um documento verificado da mesma unidade e competência.');
 const saved=await this.db.getClient().from('supplier_spot_reconciliations').insert([{organization_id:t.organizationId,customer_id:view.contract.customer_id,consumer_unit_id:view.contract.consumer_unit_id,contract_id:d.contractId,month:d.month,status:d.status,document_id:doc.id,document_sha256:doc.file_hash,source_hash:d.sourceHash,source_snapshot:r.reconciliationContext.payload,reason:d.reason.trim(),previous_id:d.previousId||null,created_by:t.userId}]).select().single();this.fail(saved.error);return (await auditAuthorNames(this.db.getClient(),t.organizationId,[saved.data]))[0];
 }
}
