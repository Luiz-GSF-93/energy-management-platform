import {classSuccessorId} from './class-parameter-successor';
import {reviewedLayoutSupported,combinedTaxLayout} from './reviewed-layout-support';
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
import {tusdParameterCandidates} from './tusd-parameter-candidates';
import {monthPeriod} from '../contracts/services/preparation';
function parameterId(org:string,doc:string,band:string){const h=createHash('sha256').update(JSON.stringify(['ocr-tusd-draft-v1',org,doc,band])).digest('hex');return h.slice(0,8)+'-'+h.slice(8,12)+'-5'+h.slice(13,16)+'-8'+h.slice(17,20)+'-'+h.slice(20,32);}
@Injectable()
export class OcrTusdIntegrationService {
 constructor(private db:SupabaseService,private licenses:LicensesService,private queue:OcrQueueService,private identity:OcrIdentityReviewService,private consumption:OcrReviewService){}
 private fail(error:any){if(error)throw new ServiceUnavailableException('Não foi possível consultar ou criar os rascunhos TUSD. Atualize a situação antes de tentar novamente.');}
 private canWrite(t:TenantContext){return !!t?.userId&&!!t.organizationId&&(['admin_org','gestor'].includes(t.role)||t.accessMode==='platform_operation')&&t.permissions?.includes(P.ORGANIZATION_CONTRACTS_CREATE);}
 private async context(document:string,t:TenantContext){
  if(!t?.userId||!t.organizationId||![P.DOCUMENTS_VIEW,P.ORGANIZATION_CONTRACTS_VIEW].every(p=>t.permissions?.includes(p)))throw new ForbiddenException('A integração exige acesso aos documentos e contratos.');
  await this.licenses.requireEntitlement(t.organizationId,'free_market_management');
  const source=await this.queue.reviewSource(t.organizationId,document),client=this.db.getClient(),month=String(source.doc.reference_month).slice(0,7),period=monthPeriod(month);
  const [identity,consumption,unitResult,parameterResult]=await Promise.all([this.identity.list(t.organizationId,document),this.consumption.list(t.organizationId,document),client.from('consumer_units').select('*').eq('organization_id',t.organizationId).eq('id',source.doc.consumer_unit_id).eq('customer_id',source.doc.customer_id).maybeSingle(),client.from('calculation_parameters').select('*').eq('organization_id',t.organizationId).eq('consumer_unit_id',source.doc.consumer_unit_id).eq('kind','TARIFF').eq('component_code','TUSD_ENERGY').eq('scenario','ACL').range(0,999)]);
  this.fail(unitResult.error);this.fail(parameterResult.error);if(!unitResult.data||!Array.isArray(parameterResult.data)||parameterResult.data.length>=1000)this.fail(true);
  const unit=unitResult.data,layout=extractCpflPaulistaLayout(source.raw),candidates=tusdParameterCandidates(layout.operations,combinedTaxLayout(layout)),refs=[...new Set(layout.fields.filter(f=>f.name==='reference').map(f=>cpflReference(f.value.text)))];
  const ids=candidates.map(c=>classSuccessorId(parameterId(t.organizationId,document,c.band),parameterResult.data)),existing=parameterResult.data.filter((p:any)=>ids.includes(p.id));
  const overlap=parameterResult.data.filter((p:any)=>!ids.includes(p.id)&&p.status!=='RETIRED'&&p.start_date<=period.end&&p.end_date>=period.start);
  const groups=homologationProgress(identity.fields,consumption.fields,[]).groups;
  const ready=unit.status==='ACTIVE'&&unit.free_market===true&&unit.tariff_group==='A'&&reviewedLayoutSupported(layout.layoutId)&&refs.length===1&&refs[0]===month&&layout.reconciliation.state==='MATCH'&&groups[0].complete&&groups[1].complete&&candidates.every(c=>c.ready);
  const reviews={identity:identity.fields.map(f=>({key:f.key,hash:f.sourceHash,id:f.history[0]?.id})),consumption:consumption.fields.map(f=>({key:f.key,hash:f.sourceHash,id:f.history[0]?.id}))};
  const token=ocrReviewDigest({document,job:source.jobId,fileHash:source.doc.file_hash,unit,candidates,reviews,existing,overlap});
  const state=existing.length===2?'CREATED':existing.length||overlap.length?'EXISTING_RECORD':ready?'READY':'REVIEW_REQUIRED';
  return {sourceReady:ready,source,unit,period,reviews,ids,preview:{token,month,candidates,state,canCreate:state==='READY'&&this.canWrite(t),existing:existing.map((p:any)=>({id:p.id,band:p.time_band,status:p.status,revision:p.revision})),message:state==='CREATED'?'Parâmetros TUSD registrados. A situação atual de cada posto está indicada abaixo.':state==='EXISTING_RECORD'?'Já existe parâmetro TUSD para este período. Nenhum registro será substituído ou duplicado.':ready?'TUSD ponta e fora ponta disponíveis para criar rascunhos ACL com tributos incluídos.':'Confira identidade, consumos, competência, totais e evidências TUSD antes de criar os rascunhos.'}};
 }
 async taxIntegrationSource(document:string,t:TenantContext){const c=await this.context(document,t);return {...c,taxIds:['ICMS','PIS','COFINS'].map(code=>parameterId(t.organizationId,document,'TAX-'+code))};}
 async preview(document:string,t:TenantContext){return (await this.context(document,t)).preview;}
 async create(document:string,t:TenantContext,body:any){
  if(!this.canWrite(t))throw new ForbiddenException('A criação exige Gestor ou Administrador com permissão de cadastro de contratos.');
  if(!body||Array.isArray(body)||Object.keys(body).length!==1||typeof body.token!=='string'||!/^[a-f0-9]{64}$/.test(body.token))throw new BadRequestException('Atualize a prévia antes de criar.');
  const c=await this.context(document,t);if(c.preview.state==='CREATED')return {alreadyCreated:true,parameterIds:c.ids};
  if(body.token!==c.preview.token)throw new ConflictException('A prévia mudou. Atualize antes de criar os rascunhos.');if(!c.preview.canCreate)throw new ConflictException(c.preview.message);
  const context=Object.fromEntries(['distributor','tariff_group','tariff_subgroup','tariff_modality','state','consumption_class','free_market'].map(k=>[k,c.unit[k]??null]));
  const rows=c.preview.candidates.map((v,i)=>({id:c.ids[i],organization_id:t.organizationId,customer_id:c.source.doc.customer_id,consumer_unit_id:c.unit.id,kind:'TARIFF',component_code:'TUSD_ENERGY',label:'TUSD energia '+(v.band==='PEAK'?'ponta':'fora ponta'),scenario:'ACL',time_band:v.band,measure:'BRL_MWH',amount_text:v.rateMwh,treatment:'GROSS',embedded_tax_codes:['ICMS','PIS','COFINS'],included_taxes:'ICMS e PIS/Cofins destacados na linha, individualmente ou em conjunto conforme a fatura; incluídos na tarifa bruta.',base_rule:'',direction:'DEBIT',source:'OCR fatura · documento '+document+' · SHA-256 '+c.source.doc.file_hash+' · '+v.source,
   notes:'Rascunho OCR. '+v.reason+' Tarifa impressa '+v.rateKwh+' R$/kWh; tarifa de cálculo '+v.rateMwh+' R$/MWh. Quantidade '+v.quantity+' kWh; operação R$ '+v.amount+'. Vigência limitada à competência faturada. Aprovação e conciliação tributária pendentes. Prévia '+c.preview.token+'. Conferências '+JSON.stringify(c.reviews),start_date:c.period.start,end_date:c.period.end,unit_context:context,status:'DRAFT',created_by:t.userId,updated_by:t.userId}));
  // One INSERT statement is atomic; deterministic IDs prevent duplicate batches after retries.
  const r=await this.db.getClient().from('calculation_parameters').insert(rows).select('id');
  if(r.error?.code==='23505'){const current=await this.context(document,t);if(current.preview.state==='CREATED')return {alreadyCreated:true,parameterIds:c.ids};throw new ConflictException('Os parâmetros mudaram. Atualize a consulta.');}
  this.fail(r.error);if(!Array.isArray(r.data)||r.data.length!==2)this.fail(true);return {alreadyCreated:false,parameterIds:c.ids};
 }

 private async taxContext(document:string,t:TenantContext){
  const c=await this.context(document,t),codes=['ICMS','PIS','COFINS'],keys=['icmsAmount','pisAmount','cofinsAmount'];
  const r=await this.db.getClient().from('calculation_parameters').select('*').eq('organization_id',t.organizationId).eq('consumer_unit_id',c.unit.id).eq('scenario','ACL').range(0,999);this.fail(r.error);if(!Array.isArray(r.data)||r.data.length>=1000)this.fail(true);
  const rows=r.data,ids=codes.map(code=>parameterId(t.organizationId,document,'TAX-'+code)),existing=rows.filter((p:any)=>ids.includes(p.id));
  const bases=c.ids.map(id=>rows.find((p:any)=>p.id===id)),overlap=rows.some((p:any)=>!ids.includes(p.id)&&p.kind==='TAX'&&codes.includes(p.component_code)&&p.status!=='RETIRED'&&p.start_date<=c.period.end&&p.end_date>=c.period.start);
  const validBases=c.sourceReady&&bases.every((p:any,i:number)=>p&&p.status==='APPROVED'&&p.kind==='TARIFF'&&p.component_code==='TUSD_ENERGY'&&p.time_band===c.preview.candidates[i].band&&p.customer_id===c.source.doc.customer_id&&p.measure==='BRL_MWH'&&p.amount_text===c.preview.candidates[i].rateMwh&&p.treatment==='GROSS'&&codes.every(code=>p.embedded_tax_codes?.includes(code))&&p.start_date===c.period.start&&p.end_date===c.period.end);
  const taxLayout=extractCpflPaulistaLayout(c.source.raw),operations=taxLayout.operations,combined=combinedTaxLayout(taxLayout);
  const amounts=codes.map((code,i)=>{const values=c.preview.candidates.map(v=>operations.find(o=>o.source===v.source)?.fields[keys[i]]?.decimal??null);const valid=values.every(v=>typeof v==='string'&&/^\d+(?:[.]\d{1,2})?$/.test(v));let amount:string|null=null;if(valid){const n=values.reduce((s,v)=>{const [a,b='']=v!.split('.');return s+BigInt(a)*100n+BigInt(b.padEnd(2,'0'));},0n);amount=(n/100n).toString()+'.'+(n%100n).toString().padStart(2,'0');}return {code,peak:values[0],offPeak:values[1],amount,combined:combined&&code!=='ICMS'};});
  const state=existing.length===3?'CREATED':existing.length||overlap?'EXISTING_RECORD':validBases&&amounts.every(a=>a.amount!==null||a.combined)?'READY':'BASE_APPROVAL_REQUIRED';
  const token=ocrReviewDigest({source:c.preview.token,bases,existing,amounts,overlap});
  return {c,ids,bases,preview:{token,month:c.preview.month,state,amounts,canCreate:state==='READY'&&this.canWrite(t),message:state==='CREATED'?'Declarações de tributos incluídos já registradas. Consulte o histórico dos parâmetros.':state==='EXISTING_RECORD'?'Há declarações tributárias existentes neste período. Nenhum registro será substituído.':state==='READY'?'Base TUSD aprovada e compatível com a fatura. Disponível para criar três declarações em rascunho.':'Confira e aprove os dois parâmetros TUSD compatíveis com esta fatura antes de vincular os tributos. Identidade, consumo e evidência devem permanecer conferidos.'}};
 }
 async taxPreview(document:string,t:TenantContext){return (await this.taxContext(document,t)).preview;}
 async createTaxes(document:string,t:TenantContext,body:any){
  if(!this.canWrite(t))throw new ForbiddenException('A criação exige Gestor ou Administrador com permissão de cadastro de contratos.');
  if(!body||Array.isArray(body)||Object.keys(body).length!==1||typeof body.token!=='string'||!/^[a-f0-9]{64}$/.test(body.token))throw new BadRequestException('Atualize a prévia antes de criar.');
  const x=await this.taxContext(document,t);if(x.preview.state==='CREATED')return {alreadyCreated:true,parameterIds:x.ids};if(body.token!==x.preview.token||!x.preview.canCreate)throw new ConflictException('A base mudou ou está pendente. Atualize e confira os parâmetros TUSD.');
  const {c}=x,rows=x.preview.amounts.map((v,i)=>({id:x.ids[i],organization_id:t.organizationId,customer_id:c.source.doc.customer_id,consumer_unit_id:c.unit.id,kind:'TAX',component_code:v.code,label:v.code+' incluído na TUSD da fatura',scenario:'ACL',time_band:'ALL',measure:'PERCENT',amount_text:null,treatment:'INCLUDED',embedded_tax_codes:[],included_taxes:'',base_rule:'Declaração somente sobre TUSD ponta e fora ponta; sem nova incidência.',tax_basis:{version:1,items:x.bases.map((p:any)=>({parameterId:p.id,revision:p.revision,operation:'INCLUDE'}))},direction:'DEBIT',source:'OCR fatura · documento '+document+' · SHA-256 '+c.source.doc.file_hash,notes:v.combined?'PIS/Cofins apresentados em coluna conjunta na Elektro. Inclusão pela tarifa bruta e conciliação do resumo; sem ratear valores individuais, inferir alíquota ou cobrar novamente. Prévia '+x.preview.token:'Destaque da fatura: ponta R$ '+v.peak+'; fora ponta R$ '+v.offPeak+'; soma R$ '+v.amount+'. Valores informativos de conciliação, não são alíquota nem custo adicional. Demais componentes não abrangidos. Prévia '+x.preview.token,start_date:c.period.start,end_date:c.period.end,unit_context:x.bases[0].unit_context,status:'DRAFT',created_by:t.userId,updated_by:t.userId}));
  const r=await this.db.getClient().from('calculation_parameters').insert(rows).select('id');if(r.error?.code==='23505'){const next=await this.taxContext(document,t);if(next.preview.state==='CREATED')return {alreadyCreated:true,parameterIds:x.ids};throw new ConflictException('Os parâmetros mudaram. Atualize a consulta.');}this.fail(r.error);if(r.data?.length!==3)this.fail(true);return {alreadyCreated:false,parameterIds:x.ids};
 }
}
