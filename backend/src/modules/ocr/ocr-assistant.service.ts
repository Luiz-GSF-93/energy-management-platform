import {createHash} from 'node:crypto';
import {ocrDraftRole,ocrDraftPermission} from './ocr-draft-access';
import {inspectOnce} from './ocr-read-scope';
import {OcrIdentityReviewService} from './ocr-identity-review.service';
import {OcrDemandReviewService} from './ocr-demand-review.service';
import {BadRequestException, ConflictException, ForbiddenException, Injectable, Optional, ServiceUnavailableException} from '@nestjs/common';
import {TenantContext} from '../../common/interfaces/tenant-context.interface';
import {PERMISSIONS as P} from '../../common/constants/permissions';
import {SupabaseService} from '../../services/supabase.service';
import {LicensesService} from '../licenses/services/licenses.service';
import {CalculationPreparationService} from '../contracts/services/preparation.service';
import {OcrQueueService} from './ocr-queue.service';
import {OcrReviewService, ocrReviewDigest} from './ocr-review.service';
import {OcrMonthlyIntegrationService} from './ocr-monthly-integration.service';
import {OcrDemandIntegrationService} from './ocr-demand-integration.service';
import {OcrTusdIntegrationService} from './ocr-tusd-integration.service';
import {OcrCdeIntegrationService} from './ocr-cde-integration.service';
import {OcrSplitDemandIntegrationService} from './ocr-split-demand-integration.service';
import {OcrReactiveIntegrationService} from './ocr-reactive-integration.service';
import {OcrCipIntegrationService} from './ocr-cip-integration.service';
import {OcrCdeTaxIntegrationService} from './ocr-cde-tax-integration.service';
import {OcrDemandTaxIntegrationService} from './ocr-demand-tax-integration.service';
import {ocrReadoutSummary} from './invoice-readout';
import {assistantHistory} from './ocr-assistant-history';
import {OcrAutofillService} from './ocr-autofill.service';

type Preview = {token:string; state:string; canCreate:boolean; message:string; values?:unknown; candidates?:unknown; candidate?:{ready?:boolean}; existing?:unknown};
const canPropose=(p:Preview)=>p.canCreate||(['REVIEWS_PENDING','CONSUMPTION_REQUIRED','MONTHLY_REQUIRED','REVIEW_REQUIRED'].includes(p.state)&&((Array.isArray(p.candidates)&&p.candidates.length>0&&p.candidates.every(c=>c.ready===true))||p.candidate?.ready===true||p.state==='REVIEWS_PENDING'&&Array.isArray(p.values)&&p.values.length>0));
type Operation = {key:string; label:string; area:string; preview:()=>Promise<Preview>; create:(token:string)=>Promise<unknown>};
@Injectable()
export class OcrAssistantService {
 constructor(private db:SupabaseService, private licenses:LicensesService, private queue:OcrQueueService,
  private preparation:CalculationPreparationService, private review:OcrReviewService,
  private monthly:OcrMonthlyIntegrationService, private demand:OcrDemandIntegrationService,
  private tusd:OcrTusdIntegrationService, private cde:OcrCdeIntegrationService,
  private split:OcrSplitDemandIntegrationService, private reactive:OcrReactiveIntegrationService,
  private cip:OcrCipIntegrationService, private cdeTax:OcrCdeTaxIntegrationService,
  private demandTax:OcrDemandTaxIntegrationService, @Optional() private identities?:OcrIdentityReviewService, @Optional() private demands?:OcrDemandReviewService, @Optional() private autofill?:OcrAutofillService) {}
 private async allowed(t:TenantContext,write=false) {
  const required=[P.DOCUMENTS_VIEW,P.ORGANIZATION_CONTRACTS_VIEW,];
  if(!t?.userId||!t.organizationId||!required.every(p=>t.permissions?.includes(p)))throw new ForbiddenException('O assistente exige acesso aos documentos e contratos desta organização.');
  if(write&&(!ocrDraftRole(t)||!ocrDraftPermission(t)))throw new ForbiddenException('Preparar rascunhos exige Operador, Gestor ou Administrador autorizado.');
  await this.licenses.requireEntitlement(t.organizationId,'document_management');
  await this.licenses.requireEntitlement(t.organizationId,'free_market_management');
 }
 private operations(document:string,t:TenantContext,readPlan=false):Operation[] {
  // Reuse a tax-family read only inside this inspection. Writes always obtain fresh previews.
  const once=<T>(read:()=>Promise<T>)=>{let value:Promise<T>|undefined;return()=>readPlan?(value??=read()):read();};
  const cdeTaxes=once(()=>this.cdeTax.preview(document,t)),demandTaxes=once(()=>this.demandTax.preview(document,t));
  const op=(key:string,label:string,area:string,service:{preview:(d:string,t:TenantContext)=>Promise<any>;create:(d:string,t:TenantContext,b:any)=>Promise<any>}):Operation=>({key,label,area,preview:()=>service.preview(document,t),create:token=>service.create(document,t,{token})});
  const operations=[op('monthly','Consumos mensais','monthly',this.monthly),op('demand','Demanda faturável','monthly',this.demand),
   op('tusd','Tarifas TUSD da fatura','parameters',this.tusd),op('cde','Tarifas CDE da fatura','parameters',this.cde),
   op('split-demand','Parcelas de demanda e tarifas','monthly',this.split),op('reactive','Reativo e tarifas','monthly',this.reactive),
   op('cip','CIP / ajustes da distribuidora','costs',this.cip),
   {key:'tusd-taxes',label:'Tributos incluídos na TUSD','area':'parameters',preview:()=>this.tusd.taxPreview(document,t),create:(token:string)=>this.tusd.createTaxes(document,t,{token})}];
  // Each tax has its own existing versioned write. No approval or in-place update is invoked here.
  for(const code of ['ICMS','PIS','COFINS']) {
   operations.push({key:'cde-tax-'+code,label:code+' — bases TUSD/CDE','area':'parameters',preview:async()=>{
    const p=await cdeTaxes(),d=p.declarations.find(v=>v.code===code)!;
    return {token:p.token,state:d.state,canCreate:d.canCreateRevision,message:d.message,values:p.amounts?.filter(v=>v.code===code)??[]};
   },create:token=>this.cdeTax.createRevision(document,t,{code,token})});
   operations.push({key:'demand-tax-'+code,label:code+' — bases demanda/reativo','area':'parameters',preview:async()=>{
    const p=await demandTaxes(),d=p.declarations.find(v=>v.code===code)!;
    return {token:p.token,state:d.state,canCreate:d.canCreate,values:d.proposed,message:d.state==='READY'?'Nova declaração tributária disponível em rascunho.':'Confira as bases aprovadas e a declaração tributária atual: '+d.state};
   },create:token=>this.demandTax.create(document,t,{code,token})});
  }
  return operations;
 }
 authorize(t:TenantContext){return this.allowed(t);}
 inspect(document:string,t:TenantContext,progress:(key:string)=>void=()=>{}) {return inspectOnce(()=>this.inspectPlan(document,t,progress));}
 private async inspectPlan(document:string,t:TenantContext,progress:(key:string)=>void) {
  await this.allowed(t);
  const source=await this.queue.reviewSource(t.organizationId,document),month=String(source.doc.reference_month).slice(0,7);
  const prefilled=await this.autofill?.inspect(document,t);
  progress('source');
  let sources:Record<string,any>={};
  const diagnosisPromise=this.preparation.inspect({consumerUnitId:source.doc.consumer_unit_id,month},t.organizationId,s=>{sources=s;}).then(d=>{progress('configuration');return d;});
  const historyQuery=this.db.getClient().from('calculation_monthly_inputs').select('id,month,version,revision,status,measurements').eq('organization_id',t.organizationId).eq('customer_id',source.doc.customer_id).eq('consumer_unit_id',source.doc.consumer_unit_id).eq('status','VALIDATED').lt('month',month).order('month',{ascending:false}).order('version',{ascending:false}).limit(100);
  const [diagnosis,reviews,identity,demand,history,previews]=await Promise.all([diagnosisPromise,this.review.list(t.organizationId,document),this.identities?.list(t.organizationId,document)??Promise.resolve({fields:[]}),this.demands?.list(t.organizationId,document)??Promise.resolve({fields:[]}),Promise.resolve(historyQuery).then((h:any)=>{progress('history');return h;}),
   Promise.all(this.operations(document,t,true).map(async op=>({key:op.key,label:op.label,area:op.area,...await op.preview()}))).then(p=>{progress('proposals');return p;})]);
  progress('fields');
  if(diagnosis.unit.id!==source.doc.consumer_unit_id||diagnosis.unit.customerId!==source.doc.customer_id||diagnosis.month!==month)throw new ConflictException('O vínculo da fatura mudou. Atualize o assistente.');
  if(history.error||!Array.isArray(history.data)||history.data.length>=100)throw new ServiceUnavailableException('Não foi possível conferir o histórico completo da unidade. Nenhum plano parcial foi liberado.');
  const fieldTasks=[['identity',identity.fields],['consumption',reviews.fields],['demand',demand.fields]].flatMap(([kind,fields])=>(fields as any[]).map(f=>({kind:String(kind),key:f.key,label:f.label,value:f.decimal,unit:f.unit,source:f.source??f.sources?.join(', ')??'',description:f.description??'',sourceHash:f.sourceHash,expectedReviewId:f.history[0]?.id??null,canConfirm:['EXTRACTED_REVIEW','BILLED_UNCLASSIFIED'].includes(f.state)&&typeof f.decimal==='string'&&f.history[0]?.decision!=='NEEDS_CORRECTION',confirmed:['CONFIRMED','USED','UNUSED'].includes(f.history[0]?.decision)&&f.history[0]?.sourceHash===f.sourceHash})));
  const basis=ocrReviewDigest({doc:source.doc,raw:source.raw,sources:{...sources,ocrDocuments:undefined},history:history.data});
  const consumption=reviews.fields.find(f=>f.key==='consumptionTotalKwh')?.decimal??null;
  const comparisons=assistantHistory(consumption,history.data);
  const confidence=ocrReadoutSummary(source.raw,source.assessment.intake.checks);
  const token=ocrReviewDigest({format:'ocr-assistant-1',organization:t.organizationId,actor:t.userId,document:source.doc,job:source.jobId,raw:ocrReviewDigest(source.raw),sources,reviews,identity,demand,history:history.data,previews,prefilled:prefilled??null});
  const areas=[['distributor','Distribuidora e unidade',['Unidade']],['supply','Contrato e fornecedor',['Fornecedor','Preços','Volumes']],['management','Honorários vigentes',['Honorários']],['parameters','Tarifas e parâmetros',['Parâmetros','Tributos','Bases tributárias','Bases operacionais']],['monthly','Dados mensais',['Medições']],['costs','Custos mensais',['Custos mensais','Custos adicionais']]] as const;
  progress('ready');
  return {token,basis,fieldTasks,prefilled,canValidate:ocrDraftRole(t)&&t.permissions?.includes(P.ENERGIA_OCR_PROCESS),documentId:document,customerId:diagnosis.unit.customerId,unitId:diagnosis.unit.id,unitName:diagnosis.unit.name,month,checkedAt:new Date().toISOString(),
   extractionEngine:'Azure Document Intelligence',calculationEngine:'Motor ACL × ACR existente',confidence,
   values:reviews.fields.map(f=>({key:f.key,label:f.label,value:f.decimal,unit:f.unit,state:f.state,sources:f.sources,review:f.history[0]?.sourceHash===f.sourceHash?f.history[0]:null})),
   comparisons,operations:previews.map(p=>({...p,canPropose:ocrDraftRole(t)&&ocrDraftPermission(t)&&canPropose(p),evidenceHash:ocrReviewDigest({values:p.values??null,candidates:p.candidates??null,candidate:p.candidate??null})})),counts:diagnosis.counts,findings:diagnosis.findings,
   configurations:areas.map(([area,label,sections])=>({area,label,state:diagnosis.findings.some(f=>(sections as readonly string[]).includes(f.section)&&f.severity==='BLOCKER')?'ACTION_REQUIRED':'AVAILABLE',findings:diagnosis.findings.filter(f=>(sections as readonly string[]).includes(f.section))})),
   records:{measurements:diagnosis.measurements,costs:diagnosis.costs,catalog:diagnosis.catalog,suppliers:diagnosis.suppliers,feeCoverage:diagnosis.feeCoverage,managementFees:diagnosis.managementFeeMemory},
   canPrepare:diagnosis.counts.blockers===0,canPublish:false as const,
   message:'Extração IA e conferência pelas regras do backend. Configurações vigentes são reutilizadas; dúvidas exigem revisão. A execução cria somente rascunhos permitidos pelos serviços atuais, sem aprovar ou publicar apuração.'};
 }
 async validate(document:string,t:TenantContext,body:any) {
  await this.allowed(t);
  if(!ocrDraftRole(t)||!t.permissions.includes(P.ENERGIA_OCR_PROCESS))throw new ForbiddenException('Validação exige Operador, Gestor ou Administrador com permissão OCR.');
  const keys=['acknowledged','checkedPdf','fields','note','operations','requestId','token'];
  if(!body||Array.isArray(body)||Object.keys(body).sort().join(',')!==keys.sort().join(',')||body.acknowledged!==true||body.checkedPdf!==true||typeof body.note!=='string'||body.note.trim().length<3||body.note.length>500||!/^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(body.requestId)||!/^[a-f0-9]{64}$/.test(body.token)||!Array.isArray(body.fields)||body.fields.length>32||body.fields.some((f:any)=>!f||Object.keys(f).sort().join(',')!=='decision,key'||typeof f.key!=='string'||!['CONFIRMED','USED','UNUSED'].includes(f.decision))||new Set(body.fields.map((f:any)=>f.key)).size!==body.fields.length||!Array.isArray(body.operations)||body.operations.length>14||body.operations.some((k:any)=>typeof k!=='string')||new Set(body.operations).size!==body.operations.length||(!body.fields.length&&!body.operations.length))throw new BadRequestException('Confira os preenchimentos, o PDF e a justificativa antes de validar.');
  const plan=await this.inspect(document,t);
  if(body.token!==plan.token)throw new ConflictException('Fontes ou preenchimentos mudaram. Atualize antes de validar.');
  const tasks=plan.fieldTasks.filter(f=>body.fields.some((r:any)=>r.key===f.kind+':'+f.key));
  if(tasks.length!==body.fields.length||tasks.some(f=>!f.canConfirm||f.confirmed||(f.kind==='demand'?!['USED','UNUSED'].includes(body.fields.find((r:any)=>r.key===f.kind+':'+f.key).decision):body.fields.find((r:any)=>r.key===f.kind+':'+f.key).decision!=='CONFIRMED'))||body.operations.some((key:string)=>!plan.operations.some(p=>p.key===key&&p.canPropose)))throw new ConflictException('Há campos bloqueados, existentes ou não disponíveis. Nenhuma validação foi iniciada.');
  if(body.operations.length)await this.allowed(t,true);
  const receipts:{key:string;label:string;state:string;message?:string;result?:unknown}[]=[];
  let stopped=false;
  for(const f of tasks){
   try{
    const hash=createHash('sha256').update(body.requestId+':'+f.kind+':'+f.key).digest('hex');
    const requestId=hash.slice(0,8)+'-'+hash.slice(8,12)+'-4'+hash.slice(13,16)+'-a'+hash.slice(17,20)+'-'+hash.slice(20,32);
    const input={fieldKey:f.key,sourceHash:f.sourceHash,decision:body.fields.find((r:any)=>r.key===f.kind+':'+f.key).decision,note:body.note.trim(),expectedReviewId:f.expectedReviewId,requestId,checkedPdf:true};
    if(f.kind==='identity')await this.identities!.create(t.organizationId,document,t,input);
    else if(f.kind==='demand')await this.demands!.create(t.organizationId,document,t,input);
    else await this.review.create(t.organizationId,document,t.userId,input);
    receipts.push({key:f.kind+':'+f.key,label:f.label,state:'REVIEW_SAVED'});
   }catch{receipts.push({key:f.kind+':'+f.key,label:f.label,state:'VERIFY_REQUIRED',message:'Confira o histórico antes de repetir; confirmações anteriores foram preservadas.'});stopped=true;break;}
  }
  if(!stopped&&body.operations.length){
   let checked:Awaited<ReturnType<OcrAssistantService['inspect']>>|null=null;
   try{checked=await this.inspect(document,t);}catch{receipts.push({key:'sources',label:'Fontes e cadastros',state:'VERIFY_REQUIRED',message:'A conferência falhou. Confirmações salvas foram preservadas; atualize antes de continuar.'});stopped=true;}
   if(checked&&checked.basis!==plan.basis){receipts.push({key:'sources',label:'Fontes e cadastros',state:'REVIEW_REQUIRED',message:'O cadastro mudou durante a validação. Atualize antes de preparar lançamentos.'});stopped=true;}
   for(const op of this.operations(document,t).filter(op=>body.operations.includes(op.key))){
    if(stopped)break;
    try{
     const preview=await op.preview(),expected=plan.operations.find(p=>p.key===op.key)!;
     if(!preview.canCreate){receipts.push({key:op.key,label:op.label,state:'REVIEW_REQUIRED',message:preview.message});continue;}
     if(ocrReviewDigest({values:preview.values??null,candidates:preview.candidates??null,candidate:preview.candidate??null})!==expected.evidenceHash){receipts.push({key:op.key,label:op.label,state:'REVIEW_REQUIRED',message:'Os valores propostos mudaram. Confira esta etapa; lançamentos independentes continuam.'});continue;}
     const result=await op.create(preview.token);receipts.push({key:op.key,label:op.label,state:'SAVED_DRAFT',result});
    }catch{receipts.push({key:op.key,label:op.label,state:'VERIFY_REQUIRED',message:'Confira o histórico antes de repetir; lançamentos anteriores foram preservados.'});stopped=true;}
   }
  }
  let current:Awaited<ReturnType<OcrAssistantService['inspect']>>|null=null;
  try{current=await this.inspect(document,t);}catch{/* Preserve successful receipts, never repeat a write. */}
  return {receipts,current,complete:!stopped&&receipts.every(r=>['REVIEW_SAVED','SAVED_DRAFT'].includes(r.state)),canPublish:false,message:'Validações e rascunhos registrados abaixo. Etapas que exigem revisão permanecem identificadas. Aprovação financeira exclusiva do gestor/administrador.'};
 }
 async apply(document:string,t:TenantContext,body:unknown) {
  await this.allowed(t,true);
  if(!body||typeof body!=='object'||Array.isArray(body))throw new BadRequestException('Confirme o plano antes de lançar.');
  const b=body as Record<string,unknown>;
  if(Object.keys(b).sort().join(',')!=='acknowledged,operations,token'||b.acknowledged!==true||typeof b.token!=='string'||!/^[a-f0-9]{64}$/.test(b.token)||!Array.isArray(b.operations)||!b.operations.length||b.operations.length>14||b.operations.some(k=>typeof k!=='string')||new Set(b.operations).size!==b.operations.length)throw new BadRequestException('Confirme o plano atual e os lançamentos selecionados.');
  const plan=await this.inspect(document,t);
  if(plan.token!==b.token)throw new ConflictException('Os dados ou as evidências mudaram. Atualize e confirme novamente o plano.');
  if(b.operations.some(key=>!plan.operations.some(op=>op.key===key&&op.canCreate)))throw new ConflictException('Há lançamentos pendentes de conferência ou sem permissão. Nenhum lançamento foi iniciado.');
  const selected=b.operations as string[];
  const receipts:{key:string;label:string;state:string;result?:unknown;message?:string}[]=[];
  for(const op of this.operations(document,t).filter(op=>selected.includes(op.key))) {
   try {
    // A previous integration can change a dependent preview. Re-check the underlying service immediately.
    const current=await op.preview();
    if(!current.canCreate){receipts.push({key:op.key,label:op.label,state:'REVIEW_REQUIRED',message:current.message});break;}
    if(current.token!==plan.operations.find(p=>p.key===op.key)?.token){receipts.push({key:op.key,label:op.label,state:'REVIEW_REQUIRED',message:'A prévia mudou durante o lote. Confirme novamente os valores e as fontes antes de continuar.'});break;}
    const result=await op.create(current.token);
    receipts.push({key:op.key,label:op.label,state:'SAVED_DRAFT',result});
   }catch {
    // A write may have committed before its response failed. Stop and expose uncertainty; never retry automatically.
    receipts.push({key:op.key,label:op.label,state:'VERIFY_REQUIRED',message:'Não foi possível confirmar esta etapa. Consulte o histórico antes de tentar novamente. Etapas anteriores permanecem salvas.'});break;
   }
  }
  let current:Awaited<ReturnType<OcrAssistantService['inspect']>>|null=null;
  try{current=await this.inspect(document,t);}catch{/* Saved receipts remain successful if the final read fails. */}
  return {documentId:document,receipts,complete:receipts.length===b.operations.length&&receipts.every(r=>r.state==='SAVED_DRAFT'),current,canPublish:false as const,
   message:current?'Lançamentos conferidos abaixo. Revise e valide os rascunhos antes de preparar a apuração.':'Lançamentos registrados abaixo. A consulta final falhou; atualize o painel para conferir as pendências atuais.'};
 }
}
