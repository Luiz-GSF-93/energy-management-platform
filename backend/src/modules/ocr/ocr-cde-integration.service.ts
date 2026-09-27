import {Injectable,ForbiddenException,ConflictException,BadRequestException,ServiceUnavailableException} from '@nestjs/common';
import {createHash} from 'node:crypto';
import {SupabaseService} from '../../services/supabase.service';
import {TenantContext} from '../../common/interfaces/tenant-context.interface';
import {PERMISSIONS as P} from '../../common/constants/permissions';
import {LicensesService} from '../licenses/services/licenses.service';
import {OcrQueueService} from './ocr-queue.service';
import {OcrIdentityReviewService} from './ocr-identity-review.service';
import {OcrReviewService,ocrReviewDigest} from './ocr-review.service';
import {homologationProgress} from './homologation-progress';
import {extractCpflPaulistaLayout} from './cpfl-paulista-layout';
import {cpflReference} from './cpfl-measurements';
import {OcrCdeReviewService,cdeReviewCandidates} from './ocr-cde-review.service';
import {cdeConfidenceDiagnostics} from './cde-confidence';
import {cdeParameterCandidates} from './cde-parameter-candidates';
import {tariffProduct} from '../contracts/services/tariff-preview';
import {monthPeriod} from '../contracts/services/preparation';
function parameterId(org:string,doc:string,band:string){const h=createHash('sha256').update(JSON.stringify(['ocr-cde-draft-v1',org,doc,band])).digest('hex');return h.slice(0,8)+'-'+h.slice(8,12)+'-5'+h.slice(13,16)+'-8'+h.slice(17,20)+'-'+h.slice(20,32);}
@Injectable()
export class OcrCdeIntegrationService {
 constructor(private db:SupabaseService,private licenses:LicensesService,private queue:OcrQueueService,private identity:OcrIdentityReviewService,private consumption:OcrReviewService,private cdeReviews:OcrCdeReviewService){}
 private fail(error:any){if(error)throw new ServiceUnavailableException('Não foi possível consultar ou criar os rascunhos CDE. Atualize a situação antes de tentar novamente.');}
 private canWrite(t:TenantContext){return !!t?.userId&&!!t.organizationId&&(['admin_org','gestor'].includes(t.role)||t.accessMode==='platform_operation')&&t.permissions?.includes(P.ORGANIZATION_CONTRACTS_CREATE);}
 private async context(document:string,t:TenantContext){
  if(!t?.userId||!t.organizationId||![P.DOCUMENTS_VIEW,P.ORGANIZATION_CONTRACTS_VIEW].every(p=>t.permissions?.includes(p)))throw new ForbiddenException('A integração exige acesso aos documentos e contratos.');
  await this.licenses.requireEntitlement(t.organizationId,'free_market_management');
  const source=await this.queue.reviewSource(t.organizationId,document),client=this.db.getClient(),month=String(source.doc.reference_month).slice(0,7),period=monthPeriod(month);
  const [identity,consumption,cdeReviews,unitResult,parameterResult]=await Promise.all([this.identity.list(t.organizationId,document),this.consumption.list(t.organizationId,document),this.cdeReviews.list(t.organizationId,document),client.from('consumer_units').select('*').eq('organization_id',t.organizationId).eq('id',source.doc.consumer_unit_id).eq('customer_id',source.doc.customer_id).maybeSingle(),client.from('calculation_parameters').select('*').eq('organization_id',t.organizationId).eq('consumer_unit_id',source.doc.consumer_unit_id).eq('kind','TARIFF').eq('component_code','CDE_WATER_SCARCITY').eq('scenario','ACL').range(0,999)]);
  this.fail(unitResult.error);this.fail(parameterResult.error);if(!unitResult.data||!Array.isArray(parameterResult.data)||parameterResult.data.length>=1000)this.fail(true);
  const reviewCandidates=cdeReviewCandidates(t.organizationId,source),confirmed=new Set<string>(),corrections=new Set<string>();
  for(const c of reviewCandidates){const f=cdeReviews.fields.find(f=>f.key===c.field.key),last=f?.history[0];if(last?.sourceHash!==c.sourceHash)continue;if(last.decision==='CONFIRMED'&&c.field.state==='EXTRACTED_DESCRIPTION')confirmed.add(c.field.source);if(last.decision==='NEEDS_CORRECTION')corrections.add(c.field.source);}
  const unit=unitResult.data,layout=extractCpflPaulistaLayout(source.raw),candidates=cdeParameterCandidates(layout.operations,confirmed).map(c=>corrections.has(c.source??'')?{...c,ready:false,reason:'A última conferência solicita correção da descrição CDE. Registre nova revisão após corrigir.',rateKwh:null,rateMwh:null,quantity:null,amount:null}:c),refs=[...new Set(layout.fields.filter(f=>f.name==='reference').map(f=>cpflReference(f.value.text)))];
  const ids=candidates.map(c=>parameterId(t.organizationId,document,c.band)),existing=parameterResult.data.filter((p:any)=>ids.includes(p.id));
  const overlap=parameterResult.data.filter((p:any)=>!ids.includes(p.id)&&p.status!=='RETIRED'&&p.start_date<=period.end&&p.end_date>=period.start);
  const groups=homologationProgress(identity.fields,consumption.fields,[]).groups;
  const quantitiesMatch=candidates.every(c=>{const review=consumption.fields.find(f=>f.key===(c.band==='PEAK'?'consumptionPeakKwh':'consumptionOffPeakKwh'));try{return !!c.quantity&&!!review?.decimal&&tariffProduct(c.quantity,'1').exact===tariffProduct(review.decimal,'1').exact;}catch{return false;}});
  const ready=quantitiesMatch&&unit.status==='ACTIVE'&&unit.free_market===true&&unit.tariff_group==='A'&&layout.layoutId==='cpfl-paulista-a'&&refs.length===1&&refs[0]===month&&layout.reconciliation.state==='MATCH'&&groups[0].complete&&groups[1].complete&&candidates.every(c=>c.ready);
  const reviews={cde:cdeReviews.fields.map(f=>({key:f.key,hash:f.sourceHash,id:f.history[0]?.id,decision:f.history[0]?.decision})),identity:identity.fields.map(f=>({key:f.key,hash:f.sourceHash,id:f.history[0]?.id})),consumption:consumption.fields.map(f=>({key:f.key,hash:f.sourceHash,id:f.history[0]?.id}))};
  const token=ocrReviewDigest({document,job:source.jobId,fileHash:source.doc.file_hash,unit,candidates,reviews,existing,overlap});
  const state=existing.length===2?'CREATED':existing.length||overlap.length?'EXISTING_RECORD':ready?'READY':'REVIEW_REQUIRED';
  return {source,unit,period,reviews,ids,preview:{token,month,candidates,evidence:candidates.map(c=>{const row=layout.operations.find(r=>r.source===c.source);return {descriptionReviewed:confirmed.has(c.source??''),confidence:cdeConfidenceDiagnostics(source.raw,row),band:c.band,description:row?.fields.description?.text??null,descriptionConfidence:row?.fields.description?.transcription?.confidence??null,quantity:row?.fields.quantity?.decimal??null,rate:row?.fields.grossRate?.decimal??null,amount:row?.fields.amount?.decimal??null,icms:row?.fields.icmsAmount?.decimal??null,pis:row?.fields.pisAmount?.decimal??null,cofins:row?.fields.cofinsAmount?.decimal??null};}),state,canCreate:state==='READY'&&this.canWrite(t),existing:existing.map((p:any)=>({id:p.id,status:p.status,revision:p.revision})),message:state==='CREATED'?'Rascunhos CDE já criados. Consulte as revisões e o estado atual em Parâmetros de cálculo.':state==='EXISTING_RECORD'?'Já existe parâmetro CDE para este período. Nenhum registro será substituído ou duplicado.':ready?'CDE ponta e fora ponta disponíveis para criar rascunhos ACL com tributos incluídos.':'Confira identidade, consumos, competência, totais e evidências CDE antes de criar os rascunhos.'}};
 }
 async preview(document:string,t:TenantContext){return (await this.context(document,t)).preview;}
 async create(document:string,t:TenantContext,body:any){
  if(!this.canWrite(t))throw new ForbiddenException('A criação exige Gestor ou Administrador com permissão de cadastro de contratos.');
  if(!body||Array.isArray(body)||Object.keys(body).length!==1||typeof body.token!=='string'||!/^[a-f0-9]{64}$/.test(body.token))throw new BadRequestException('Atualize a prévia antes de criar.');
  const c=await this.context(document,t);if(c.preview.state==='CREATED')return {alreadyCreated:true,parameterIds:c.ids};
  if(body.token!==c.preview.token)throw new ConflictException('A prévia mudou. Atualize antes de criar os rascunhos.');if(!c.preview.canCreate)throw new ConflictException(c.preview.message);
  const context=Object.fromEntries(['distributor','tariff_group','tariff_subgroup','tariff_modality','state','consumption_class','free_market'].map(k=>[k,c.unit[k]??null]));
  const rows=c.preview.candidates.map((v,i)=>({id:c.ids[i],organization_id:t.organizationId,customer_id:c.source.doc.customer_id,consumer_unit_id:c.unit.id,kind:'TARIFF',component_code:'CDE_WATER_SCARCITY',label:'CDE escassez hídrica '+(v.band==='PEAK'?'ponta':'fora ponta'),scenario:'ACL',time_band:v.band,measure:'BRL_MWH',amount_text:v.rateMwh,treatment:'GROSS',embedded_tax_codes:['ICMS','PIS','COFINS'],included_taxes:'ICMS, PIS e COFINS destacados na linha; já incluídos na tarifa bruta.',base_rule:'',direction:'DEBIT',source:'OCR CPFL · documento '+document+' · SHA-256 '+c.source.doc.file_hash+' · '+v.source,
   notes:'Rascunho OCR. Tarifa original '+v.rateKwh+' R$/kWh = '+v.rateMwh+' R$/MWh. Quantidade '+v.quantity+' kWh; operação R$ '+v.amount+'. Vigência limitada à competência faturada. Aprovação e conciliação tributária pendentes. Prévia '+c.preview.token+'. Conferências '+JSON.stringify(c.reviews),start_date:c.period.start,end_date:c.period.end,unit_context:context,status:'DRAFT',created_by:t.userId,updated_by:t.userId}));
  // One INSERT statement is atomic; deterministic IDs prevent duplicate batches after retries.
  const r=await this.db.getClient().from('calculation_parameters').insert(rows).select('id');
  if(r.error?.code==='23505'){const current=await this.context(document,t);if(current.preview.state==='CREATED')return {alreadyCreated:true,parameterIds:c.ids};throw new ConflictException('Os parâmetros mudaram. Atualize a consulta.');}
  this.fail(r.error);if(!Array.isArray(r.data)||r.data.length!==2)this.fail(true);return {alreadyCreated:false,parameterIds:c.ids};
 }
}
