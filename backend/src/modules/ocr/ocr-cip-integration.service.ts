import {Injectable,ForbiddenException,ConflictException,BadRequestException,ServiceUnavailableException} from '@nestjs/common';
import {createHash} from 'node:crypto';
import {SupabaseService} from '../../services/supabase.service';
import {TenantContext} from '../../common/interfaces/tenant-context.interface';
import {PERMISSIONS as P} from '../../common/constants/permissions';
import {OcrTusdIntegrationService} from './ocr-tusd-integration.service';
import {ocrReviewDigest} from './ocr-review.service';
import {extractCpflPaulistaLayout} from './cpfl-paulista-layout';
import {cipCostCandidate} from './cip-cost-candidate';
function identifier(org:string,doc:string,kind:string){const h=createHash('sha256').update(JSON.stringify(['ocr-cip-v1',org,doc,kind])).digest('hex');return h.slice(0,8)+'-'+h.slice(8,12)+'-5'+h.slice(13,16)+'-8'+h.slice(17,20)+'-'+h.slice(20,32);}
@Injectable()
export class OcrCipIntegrationService{
 constructor(private db:SupabaseService,private tusd:OcrTusdIntegrationService){}
 private canWrite(t:TenantContext){return !!t?.userId&&!!t.organizationId&&(['gestor','admin_org'].includes(t.role)||t.accessMode==='platform_operation')&&[P.DOCUMENTS_VIEW,P.ORGANIZATION_CONTRACTS_VIEW,P.ORGANIZATION_CONTRACTS_CREATE].every(p=>t.permissions?.includes(p));}
 private fail(error:any){if(error)throw new ServiceUnavailableException('Não foi possível consultar ou integrar a CIP. Atualize a situação antes de tentar novamente.');}
 private async context(document:string,t:TenantContext){
  // Reuse the scoped, licensed CPFL/ACL source and current identity/consumption confirmations.
  const c=await this.tusd.taxIntegrationSource(document,t),month=c.preview.month,client=this.db.getClient();
  const [costs,customer]=await Promise.all([client.from('calculation_monthly_costs').select('id,origin,status,version,revision,source_reference').eq('organization_id',t.organizationId).eq('customer_id',c.source.doc.customer_id).eq('consumer_unit_id',c.unit.id).eq('month',month).order('version',{ascending:false}).limit(1),client.from('customers').select('id,status,deleted_at').eq('organization_id',t.organizationId).eq('id',c.source.doc.customer_id).maybeSingle()]);
  this.fail(costs.error);this.fail(customer.error);if(!Array.isArray(costs.data)||!customer.data)this.fail(true);
  const candidate=cipCostCandidate(extractCpflPaulistaLayout(c.source.raw).operations,month),id=identifier(t.organizationId,document,'input'),itemId=identifier(t.organizationId,document,'item');
  const reference='OCR CPFL · CIP · documento '+document+' · SHA-256 '+c.source.doc.file_hash;
  const current=costs.data[0]??null,created=current?.id===id&&current.origin==='OCR_CIP'&&current.source_reference===reference;
  const ready=c.sourceReady&&customer.data.status==='ACTIVE'&&!customer.data.deleted_at&&candidate.ready;
  const state=created?'CREATED':current?'EXISTING_RECORD':ready?'READY':'REVIEW_REQUIRED';
  const token=ocrReviewDigest({source:c.preview.token,document,month,candidate,customer:customer.data,current});
  return {c,id,itemId,reference,preview:{token,month,state,candidate,canCreate:state==='READY'&&this.canWrite(t),existing:current?{id:current.id,status:current.status,version:current.version,revision:current.revision}:null,message:state==='CREATED'?'CIP registrada nos custos mensais. Consulte a versão atual e o histórico.':state==='EXISTING_RECORD'?'Já existem custos nesta unidade e competência. O lançamento existente será preservado; nenhuma duplicação ou substituição automática.':ready?'CIP pronta para criar o primeiro rascunho de custos mensais.':'Confira identidade, consumo, competência, situação do cliente e evidências da fatura antes de integrar a CIP.'}};
 }
 async preview(document:string,t:TenantContext){return (await this.context(document,t)).preview;}
 async create(document:string,t:TenantContext,body:any){
  if(!this.canWrite(t))throw new ForbiddenException('A integração exige Gestor ou Administrador com permissão para cadastrar contratos.');
  if(!body||Array.isArray(body)||Object.keys(body).length!==1||typeof body.token!=='string'||!/^[a-f0-9]{64}$/.test(body.token))throw new BadRequestException('Atualize a prévia antes de integrar.');
  const x=await this.context(document,t);if(x.preview.state==='CREATED')return {inputId:x.id,alreadyCreated:true};
  if(body.token!==x.preview.token)throw new ConflictException('A prévia mudou. Atualize antes de integrar a CIP.');
  if(!x.preview.canCreate)throw new ConflictException(x.preview.message);
  const {c}=x,v=x.preview.candidate;
  const row={id:x.id,organization_id:t.organizationId,customer_id:c.source.doc.customer_id,consumer_unit_id:c.unit.id,month:x.preview.month,origin:'OCR_CIP',status:'DRAFT',previous_id:null,costs:{noCosts:false,items:[{id:x.itemId,label:'Contribuição de iluminação pública — CIP',category:'CHARGE',scenario:'ACL',effect:'COST',amount:v.amount,source:x.reference+' · '+v.source,taxTreatment:'UNSPECIFIED'}]},source_reference:x.reference,notes:'Importação parcial: somente CIP. Confira os demais custos e créditos antes da validação. Não inclui TE ACL, descontos informativos, subtotais, devoluções ou subvenção. Ausência de tributos na linha não declara isenção. Prévia '+x.preview.token+'. Job OCR '+c.source.jobId+'.',correction_reason:'',unit_context:Object.fromEntries(['distributor','tariff_group','tariff_subgroup','tariff_modality','state','free_market'].map(k=>[k,c.unit[k]??null])),created_by:t.userId,updated_by:t.userId};
  // Existing database advisory lock/one-draft trigger and deterministic ID prevent concurrent duplicates.
  const r=await this.db.getClient().from('calculation_monthly_costs').insert(row).select('id');
  if(['23505','P3602'].includes(r.error?.code)){const next=await this.context(document,t);if(next.preview.state==='CREATED')return {inputId:x.id,alreadyCreated:true};throw new ConflictException('Os custos mudaram. Atualize; nenhum lançamento existente será substituído.');}
  this.fail(r.error);if(r.data?.length!==1||r.data[0].id!==x.id)this.fail(true);return {inputId:x.id,alreadyCreated:false};
 }
}
