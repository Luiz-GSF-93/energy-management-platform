import {Injectable,ForbiddenException,ConflictException,BadRequestException,ServiceUnavailableException} from '@nestjs/common';
import {SupabaseService} from '../../services/supabase.service';
import {LicensesService} from '../licenses/services/licenses.service';
import {TenantContext} from '../../common/interfaces/tenant-context.interface';
import {PERMISSIONS as P} from '../../common/constants/permissions';
import {OcrQueueService} from './ocr-queue.service';
import {OcrIdentityReviewService} from './ocr-identity-review.service';
import {OcrReviewService,ocrReviewDigest} from './ocr-review.service';
import {homologationProgress} from './homologation-progress';
@Injectable()
export class OcrMonthlyIntegrationService {
 constructor(private db:SupabaseService,private licenses:LicensesService,private queue:OcrQueueService,private identity:OcrIdentityReviewService,private consumption:OcrReviewService){}
 canWrite(t:TenantContext){return !!t?.userId&&!!t.organizationId&&(['gestor','admin_org'].includes(t.role)||t.accessMode==='platform_operation')&&[P.DOCUMENTS_VIEW,P.ORGANIZATION_CONTRACTS_VIEW,P.ORGANIZATION_CONTRACTS_CREATE].every(p=>t.permissions?.includes(p));}
 private async allowed(t:TenantContext){if(!t?.userId||!t.organizationId||![P.DOCUMENTS_VIEW,P.ORGANIZATION_CONTRACTS_VIEW].every(p=>t.permissions?.includes(p)))throw new ForbiddenException('A integração exige acesso aos documentos e contratos da organização.');await this.licenses.requireEntitlement(t.organizationId,'free_market_management');}
 private fail(e:any){if(!e)return;if(e.code==='P4091')throw new ConflictException('Já existem dados mensais nesta unidade e competência. Nenhum registro foi substituído.');if(['P4090','40001','23505'].includes(e.code))throw new ConflictException('A origem ou as conferências mudaram. Atualize a integração antes de continuar.');throw new ServiceUnavailableException('Não foi possível consultar ou integrar os consumos. Consulte a situação antes de tentar novamente.');}
 private async context(document:string,t:TenantContext){
 await this.allowed(t);const org=t.organizationId,source=await this.queue.reviewSource(org,document),client=this.db.getClient();
 const [identity,consumption,integrated,monthly]=await Promise.all([this.identity.list(org,document),this.consumption.list(org,document),client.from('document_ocr_monthly_integrations').select('input_id,created_at').eq('organization_id',org).eq('document_id',document).maybeSingle(),client.from('calculation_monthly_inputs').select('id,status,version').eq('organization_id',org).eq('consumer_unit_id',source.doc.consumer_unit_id).eq('month',String(source.doc.reference_month).slice(0,7)).order('version',{ascending:false}).limit(1)]);
 this.fail(integrated.error);this.fail(monthly.error);if(!Array.isArray(monthly.data))this.fail({});
 const groups=homologationProgress(identity.fields,consumption.fields,[]).groups;
 const ready=groups[0].complete&&groups[1].complete&&consumption.fields.every(f=>f.unit==='kWh'&&typeof f.decimal==='string'&&/^(0|[1-9][0-9]{0,11})([.][0-9]{1,6})?$/.test(f.decimal));
 const refs=(fields:any[])=>Object.fromEntries(fields.map(f=>[f.key,{id:f.history[0]?.id??null,sourceHash:f.sourceHash}]));
 const reviewRefs={identity:refs(identity.fields),consumption:refs(consumption.fields)};
 const token=ocrReviewDigest({document,job:source.jobId,fileHash:source.doc.file_hash,reviewRefs});
 return {reviewRefs,preview:{token,canCreate:this.canWrite(t)&&ready&&!integrated.data&&!monthly.data.length,state:integrated.data?'INTEGRATED':monthly.data.length?'EXISTING_RECORD':ready?'READY':'REVIEWS_PENDING',inputId:integrated.data?.input_id??null,integratedAt:integrated.data?.created_at??null,existingStatus:monthly.data[0]?.status??null,month:String(source.doc.reference_month).slice(0,7),values:consumption.fields.map(f=>({label:f.label,decimal:f.decimal,unit:f.unit})),message:integrated.data?'Consumos já integrados. Consulte a versão e o histórico em Dados mensais.':monthly.data.length?'Já existe um registro mensal. A integração preserva esse lançamento e não cria outra versão automaticamente.':ready?'Consumos conferidos disponíveis para criar o primeiro rascunho mensal.':'Conclua as seis conferências de identidade e as três de consumo da evidência atual.'}};
 }
 async preview(document:string,t:TenantContext){return (await this.context(document,t)).preview;}
 async create(document:string,t:TenantContext,body:any){
 if(!this.canWrite(t))throw new ForbiddenException('A integração exige Gestor ou Administrador com permissão para criar dados mensais.');
 if(!body||Array.isArray(body)||Object.keys(body).length!==1||typeof body.token!=='string'||!/^[a-f0-9]{64}$/.test(body.token))throw new BadRequestException('Atualize a prévia antes de integrar.');
 const context=await this.context(document,t);
 if(context.preview.state==='INTEGRATED')return {inputId:context.preview.inputId,alreadyIntegrated:true};
 if(body.token!==context.preview.token)throw new ConflictException('A prévia mudou. Atualize a integração.');
 if(!context.preview.canCreate)throw new ConflictException(context.preview.message);
 const r=await this.db.getClient().rpc('integrate_ocr_monthly',{p_org:t.organizationId,p_document:document,p_actor:t.userId,p_refs:context.reviewRefs});this.fail(r.error);if(!r.data?.inputId)this.fail({});return r.data;
 }
}
