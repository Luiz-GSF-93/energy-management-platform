import {Injectable,ForbiddenException,ConflictException,BadRequestException,ServiceUnavailableException} from '@nestjs/common';
import {SupabaseService} from '../../services/supabase.service';
import {TenantContext} from '../../common/interfaces/tenant-context.interface';
import {OcrMonthlyIntegrationService} from './ocr-monthly-integration.service';
import {OcrQueueService} from './ocr-queue.service';
import {OcrIdentityReviewService} from './ocr-identity-review.service';
import {OcrReviewService,ocrReviewDigest} from './ocr-review.service';
import {demandReviewDigest} from './ocr-demand-review.service';
import {homologationProgress} from './homologation-progress';
import {extractCpflPaulistaLayout} from './cpfl-paulista-layout';
import {cpflReference} from './cpfl-measurements';
import {loadDemandFinancialMemory} from '../contracts/services/demand-financial-memory';
@Injectable()
export class OcrSplitDemandIntegrationService {
 constructor(private db:SupabaseService,private monthly:OcrMonthlyIntegrationService,private queue:OcrQueueService,private identity:OcrIdentityReviewService,private consumption:OcrReviewService){}
 private fail(e:any){if(!e)return;if(['P4090','P4091','40001','23505','P3402'].includes(e.code))throw new ConflictException('A origem ou os registros mudaram. Atualize a integração; nenhum dado foi substituído.');throw new ServiceUnavailableException('Não foi possível integrar as parcelas. Atualize a situação antes de tentar novamente.');}
 private async context(document:string,t:TenantContext){
  await this.monthly.preview(document,t);
  const db=this.db.getClient(),source=await this.queue.reviewSource(t.organizationId,document),layout=extractCpflPaulistaLayout(source.raw),month=String(source.doc.reference_month).slice(0,7);
  const [identity,consumption,memory,monthly,parameters,saved]=await Promise.all([this.identity.list(t.organizationId,document),this.consumption.list(t.organizationId,document),loadDemandFinancialMemory(db,source.doc,source.jobId,layout),db.from('calculation_monthly_inputs').select('*').eq('organization_id',t.organizationId).eq('consumer_unit_id',source.doc.consumer_unit_id).eq('month',month).order('version',{ascending:false}).limit(1),db.from('calculation_parameters').select('*').eq('organization_id',t.organizationId).eq('consumer_unit_id',source.doc.consumer_unit_id).eq('scenario','ACL').eq('kind','TARIFF').in('component_code',['TUSD_DEMAND','TUSD_DEMAND_USED','TUSD_DEMAND_UNUSED']).range(0,999),db.from('document_ocr_split_demand_integrations').select('*').eq('organization_id',t.organizationId).eq('document_id',document).maybeSingle()]);
  [monthly,parameters,saved].forEach(r=>this.fail(r.error));if(!Array.isArray(monthly.data)||!Array.isArray(parameters.data)||parameters.data.length>=1000)this.fail(true);
  const current=monthly.data[0],refs=(fields:any[])=>Object.fromEntries(fields.map(f=>[f.key,{id:f.history[0]?.id??null,sourceHash:f.sourceHash}])),reviewRefs={identity:refs(identity.fields),consumption:refs(consumption.fields)};
  const groups=homologationProgress(identity.fields,consumption.fields,[]).groups;
  const candidates=(memory?.rows??[]).map(row=>{const operation=layout.operations.find(o=>o.source===row.source);const taxCodes=['ICMS','PIS','COFINS'].filter((code,i)=>{const value=operation?.fields[['icmsAmount','pisAmount','cofinsAmount'][i]]?.decimal;return typeof value==='string'&&/^\d+[.]\d{2}$/.test(value)&&Number(value)>0;});return {...row,taxCodes};});
  const demandRefs=Object.fromEntries(candidates.filter(r=>r.review).map(r=>[demandReviewDigest(r.source),{id:r.review!.id,sourceHash:r.review!.sourceHash}]));
  const reference=[...new Set(layout.fields.filter(f=>f.name==='reference').map(f=>cpflReference(f.value.text)))];
  const ready=groups[0].complete&&groups[1].complete&&memory?.state==='RECONCILED'&&layout.layoutId==='cpfl-paulista-a'&&layout.reconciliation.state==='MATCH'&&reference.length===1&&reference[0]===month&&candidates.length===2&&['USED','UNUSED'].every(k=>candidates.filter(r=>r.classification===k).length===1)&&candidates.every(r=>r.taxCodes.includes('PIS')&&r.taxCodes.includes('COFINS'));
  const scope=current?.origin==='OCR_REVIEWED'&&current?.source_ocr_document_id===document&&current?.unit_context?.tariff_group==='A'&&current?.unit_context?.tariff_modality==='GREEN'&&current?.unit_context?.free_market===true;
  const overlaps=parameters.data.filter((p:any)=>p.status!=='RETIRED'&&p.start_date<=month+'-31'&&p.end_date>=month+'-01');
  const state=saved.data?'INTEGRATED':!current?'MONTHLY_REQUIRED':!scope?'UNSUPPORTED':overlaps.length||current.billed_demand?.ACL?.used!=null||current.billed_demand?.ACL?.unused!=null?'RECORD_PRESERVED':ready?'READY':'REVIEW_REQUIRED';
  const token=ocrReviewDigest({document,job:source.jobId,fileHash:source.doc.file_hash,reviewRefs,demandRefs,candidates,current,overlaps});
  const messages:Record<string,string>={INTEGRATED:'Parcelas e tarifas integradas. Consulte a situação atual da versão mensal e dos dois parâmetros; a integração não aprova o fechamento.',MONTHLY_REQUIRED:'Integre primeiro os consumos da fatura.',UNSUPPORTED:'Integração disponível para demanda única ACL do Grupo A Verde.',RECORD_PRESERVED:'Já existem parcelas ou tarifas de demanda no período. Nenhum registro será substituído.',REVIEW_REQUIRED:'Conclua as conferências atuais e a conciliação das duas parcelas antes de integrar.',READY:current?.status==='VALIDATED'?'Será criada uma nova versão mensal e duas tarifas em rascunho. A versão validada será preservada.':'As parcelas serão acrescentadas ao rascunho mensal e duas tarifas serão criadas em rascunho.'};
  return {source,current,reviewRefs,demandRefs,candidates,ready,preview:{token,state,canCreate:state==='READY'&&this.monthly.canWrite(t),message:messages[state],inputId:saved.data?.input_id??null,parameterIds:saved.data?.parameter_ids??[],month,candidates:candidates.map(r=>({classification:r.classification,quantity:r.quantity,rate:r.rate,amount:r.amount})),targetVersion:saved.data?.source_snapshot?.targetVersion??(current?.version+(current?.status==='VALIDATED'?1:0))}};
 }
 async taxIntegrationSource(document:string,t:TenantContext){return this.context(document,t);}
 async preview(document:string,t:TenantContext){return (await this.context(document,t)).preview;}
 async create(document:string,t:TenantContext,body:any){
  if(!this.monthly.canWrite(t))throw new ForbiddenException('A integração exige Gestor ou Administrador com permissão de cadastro.');
  if(!body||Array.isArray(body)||Object.keys(body).length!==1||typeof body.token!=='string'||!/^[a-f0-9]{64}$/.test(body.token))throw new BadRequestException('Atualize a prévia antes de integrar.');
  const c=await this.context(document,t);if(c.preview.state==='INTEGRATED')return {alreadyIntegrated:true,inputId:c.preview.inputId,parameterIds:c.preview.parameterIds};
  if(body.token!==c.preview.token)throw new ConflictException('A prévia mudou. Atualize a integração.');if(!c.preview.canCreate)throw new ConflictException(c.preview.message);
  const r=await this.db.getClient().rpc('integrate_ocr_split_demand',{p_org:t.organizationId,p_document:document,p_actor:t.userId,p_input:c.current.id,p_revision:c.current.revision,p_refs:c.reviewRefs,p_demand_refs:c.demandRefs,p_job:c.source.jobId,p_file_hash:c.source.doc.file_hash,p_rows:c.candidates.map(v=>({classification:v.classification,source:v.source,quantity:v.quantity,rate:v.rate,amount:v.amount,taxCodes:v.taxCodes,reviewId:v.review?.id,sourceHash:v.review?.sourceHash}))});this.fail(r.error);if(!r.data?.inputId)this.fail({});return r.data;
 }
}
