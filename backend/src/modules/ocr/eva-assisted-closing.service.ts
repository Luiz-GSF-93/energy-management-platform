import {supplierInvoiceCostDraft} from './supplier-invoice-cost-draft';
import {preparationPolicy} from './eva-preparation-policy';
import {sharedClosingRequired,closingDocumentRequests} from './closing-coordination';
import {applyOperationalCceeReview} from './eva-operational-flow.model';
import {closingCceeLocal} from './closing-ccee-local';
import {closingDemandContext} from './closing-demand-context';
import {supplierInvoiceSetCaptureMatches} from './supplier-invoice-set';
import {documentedSettlementEnabled} from './documented-tariff-period';
import {contractClosingDraftEnabled} from './contract-closing-draft';
import {BadRequestException,ConflictException,ForbiddenException,Injectable,ServiceUnavailableException} from '@nestjs/common';
import {ConfigService} from '@nestjs/config';
import {SupabaseService} from '../../services/supabase.service';
import {TenantContext} from '../../common/interfaces/tenant-context.interface';
import {CalculationAutofillService} from './calculation-autofill.service';
import {invoiceComparisonV2} from './invoice-comparison-v2';
import {invoiceComponentTaxV3} from './invoice-component-tax-v3';
import {autofillHash} from './calculation-autofill.model';
import {assistedClosingReport,ClosingEntry} from './eva-assisted-closing.model';
import {resolutionId} from './ocr-resolution-plan';
import {ocrDraftRole,ocrDraftPermission} from './ocr-draft-access';
import {PERMISSIONS as P} from '../../common/constants/permissions';
const uuid=(v:unknown)=>typeof v==='string'&&/^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(v);
@Injectable()
export class EvaAssistedClosingService{
 private readonly invoiceCompletions=new Map<string,Promise<any>>();
 constructor(private db:SupabaseService,private config:ConfigService,private autofill:CalculationAutofillService){}
 private publicationEnabled(){return process.env.EVA_APPROVED_PUBLICATIONS_ENABLED==='true'&&process.env.EVA_APPROVED_PORTAL_ENABLED==='true';}
 private enabled(){return this.config.get('EVA_ASSISTED_CLOSING_ENABLED')==='true';}
 private scope(q:any){if(!q||!['consumerUnitId,month','consumerUnitId,month,scopeKind'].includes(Object.keys(q).sort().join(','))||q.scopeKind!==undefined&&!['UNIT','CUSTOMER'].includes(q.scopeKind)||!uuid(q.consumerUnitId)||typeof q.month!=='string'||!/^(20|21)\d{2}-(0[1-9]|1[0-2])$/.test(q.month))throw new BadRequestException('Unidade e competência inválidas.');return q;}
 private async rpc(action:string,q:any,t:TenantContext,id:string|null,body:any){
  if(!t?.organizationId||!t.userId||!t.roleId)throw new ForbiddenException('Contexto organizacional necessário.');
  const disclose=action==='decide'&&this.publicationEnabled()&&body.disclose===true;
  const contractDraft=contractClosingDraftEnabled();
  const documented=documentedSettlementEnabled()&&contractDraft;
  const r=await this.db.getClient().rpc('eva_scoped_closing_action',{p_org:t.organizationId,p_actor:t.userId,p_role:t.roleId,p_platform:t.accessMode==='platform_operation',p_action:action,p_disclose:disclose,p_mode:documented?'DOCUMENTED':contractDraft?'CONTRACT':'BASE',p_scope:q.scopeKind??'CUSTOMER',p_unit:q.consumerUnitId,p_month:q.month,p_id:id,p_body:body});
  if(!r.error&&r.data!=null)return r.data;
  if(r.error?.code==='42501')throw new ForbiddenException('Acesso restrito ao backoffice autorizado.');
  if(['23505','40001'].includes(r.error?.code))throw new ConflictException('As fontes ou a decisão mudaram. Atualize o histórico antes de continuar.');
  if(r.error?.code==='57014'&&action==='history')throw new ServiceUnavailableException('A consulta do histórico excedeu o prazo. Suas confirmações anteriores foram preservadas. Atualize o histórico antes de preparar outra versão.');
  if(r.error?.code==='57014')throw new ServiceUnavailableException({message:'A atualização da proposta excedeu o tempo de consulta. Os registros já salvos foram preservados. Consulte o histórico antes de repetir.',code:'EVA_CLOSING_SOURCE_TIMEOUT',stage:action});
  if(r.error?.code==='22023')throw new BadRequestException('Dados insuficientes ou decisão inválida.');
  throw new ServiceUnavailableException('Resultado não confirmado. Consulte o histórico antes de repetir.');
 }
 async history(q:any,t:TenantContext){if(!this.enabled())return {enabled:false};const {page='0',...scope}=q;this.scope(scope);if(typeof page!=='string'||!/^\d{1,3}$/.test(page))throw new BadRequestException('Página inválida.');const history=await this.rpc('history',scope,t,null,{page:Number(page)});let publications:any[]=[];if(this.publicationEnabled()&&history.rows?.length){const r=await this.db.getClient().rpc('read_eva_closing_publications',{p_org:t.organizationId,p_actor:t.userId,p_role:t.roleId,p_platform:t.accessMode==='platform_operation',p_portal:false,p_from:scope.month,p_to:scope.month,p_customer:history.rows[0].customer_id});if(r.error||!Array.isArray(r.data))throw new ServiceUnavailableException('Não foi possível conferir a divulgação.');publications=r.data.map((p:any)=>({id:p.id,closingId:p.closingId,state:p.state}));}return {enabled:true,guidedReviewEnabled:process.env.EVA_GUIDED_REVIEW_ENABLED!=='false',approvalPublishes:this.publicationEnabled(),publications,dialogueEnabled:this.config.get('EVA_CLOSING_DIALOGUE_ENABLED')==='true',contextEnabled:this.config.get('EVA_CLOSING_CONTEXT_ENABLED')==='true',changesEnabled:this.config.get('EVA_CLOSING_CHANGES_ENABLED')==='true',unitId:scope.consumerUnitId,month:scope.month,...history};}
 async dialogueUnit(q:any,t:TenantContext){
  if(!this.enabled())throw new ServiceUnavailableException('Fechamento desligado.');this.scope(q);
  const captured=await this.rpc('capture',q,t,null,{}),u=captured?.financial?.tables?.consumer_units?.find((u:any)=>u.id===q.consumerUnitId&&u.organization_id===t.organizationId);
  if(!u)throw new ForbiddenException('Unidade fora do escopo.');
  return Object.fromEntries(['id','distributor','tariff_group','tariff_subgroup','tariff_modality','consumption_class','voltage','state','free_market'].map(k=>[k,u[k]??null]));
 }
 /** Shared completion for the portal and Documents. Same sources reuse the same closing ID. */
 async prepareInvoice(documentId:string,sourceHash:string,q:{consumerUnitId:string;month:string;scopeKind?:'UNIT'|'CUSTOMER'},t:TenantContext){
  if(!this.enabled()||!ocrDraftRole(t)||!ocrDraftPermission(t)||!t.permissions?.includes(P.ENERGIA_OCR_PROCESS))throw new ForbiddenException('Preparação automática exige acesso interno aos rascunhos da organização.');
  this.scope(q);
  if(!uuid(documentId)||!/^[a-f0-9]{64}$/.test(sourceHash))throw new BadRequestException('Fonte da fatura inválida.');
  const current:any=await this.autofill.inspect({consumerUnitId:q.consumerUnitId,month:q.month},t);
  if(!current.available||!current.canPrepare||current.documentId!==documentId||current.sourceHash!==sourceHash||current.unitId!==q.consumerUnitId||current.month!==q.month||!/^[a-f0-9]{64}$/.test(current.basis??''))throw new ConflictException('Atualize a fonte desta unidade e competência antes de preencher.');
  const sourceBasis=await this.rpc('capture',{...q,scopeKind:'UNIT'},t,null,{});
  const scopeKind=sharedClosingRequired(sourceBasis,q.month)?'CUSTOMER':'UNIT';
  const completionKey=autofillHash([t.organizationId,scopeKind,q.month,sourceBasis,...(scopeKind==='UNIT'?[q.consumerUnitId,current.basis]:[])]);
  const flightKey=JSON.stringify([t.userId,t.roleId,t.accessMode,completionKey]);
  let pending=this.invoiceCompletions.get(flightKey);
  if(!pending){
   pending=this.prepare({...q,scopeKind,requestId:resolutionId(['eva-invoice-completion-3',completionKey])},t);
   this.invoiceCompletions.set(flightKey,pending);
  }
  let result:any;
  try{result=await pending;}finally{if(this.invoiceCompletions.get(flightKey)===pending)this.invoiceCompletions.delete(flightKey);}
  const row=result.row,unit=row?.report?.units?.find((u:any)=>u.id===q.consumerUnitId);
  if(row?.organization_id!==t.organizationId||row.month!==q.month||!unit||unit.documentId!==documentId||unit.sourceHash!==sourceHash)throw new ConflictException('O fechamento retornou fora da fonte selecionada.');
  return result;
 }
 async prepare(b:any,t:TenantContext){
  if(!this.enabled())throw new ServiceUnavailableException('Fechamento assistido desligado.');
  if(!b||!['consumerUnitId,month,requestId','consumerUnitId,month,requestId,scopeKind'].includes(Object.keys(b).sort().join(','))||!uuid(b.requestId))throw new BadRequestException('Preparação inválida.');
  const q=this.scope({consumerUnitId:b.consumerUnitId,month:b.month,...(b.scopeKind?{scopeKind:b.scopeKind}:{})});
  const rights=await this.rpc('history',q,t,null,{page:0});if(!rights.canPrepare)throw new ForbiddenException('Sem permissão para preparar.');
  const prior=rights.rows.find((r:any)=>r.id===b.requestId);if(prior)return {row:prior,replayed:true};
  let sources=await this.rpc('capture',q,t,null,{});const all=sources?.financial?.tables?.consumer_units;
  if(!Array.isArray(all)||!all.length||all.length>100||new Set(all.map((u:any)=>u.id)).size!==all.length)throw new ConflictException('Conjunto completo de unidades indisponível.');
  const primary=all.find((u:any)=>u.id===q.consumerUnitId);if(!primary)throw new ForbiddenException('Unidade fora do escopo.');
  // Check every unit before the first draft write, including inactive units.
  if(all.some((u:any)=>u.organization_id!==t.organizationId||u.customer_id!==primary.customer_id))throw new ForbiddenException('Fontes fora do escopo.');
  const snapshots=new Map<string,any>();let preparedDrafts=false;
  if(this.config.get('CALCULATION_AUTOFILL_ENABLED')==='true'&&ocrDraftRole(t)&&ocrDraftPermission(t)&&t.permissions?.includes(P.ENERGIA_OCR_PROCESS)){
   for(const u of [...all].filter(u=>q.scopeKind!=='UNIT'||u.id===q.consumerUnitId).sort((a,b)=>a.id.localeCompare(b.id))){
    if(u.status!=='ACTIVE'||(sources.commercial??[]).some((r:any)=>r.consumer_unit_id===u.id&&['RUNNING','UNKNOWN'].includes(r.state)))continue;
    const candidate=await this.autofill.closingSnapshot({consumerUnitId:u.id,month:q.month},t);snapshots.set(u.id,candidate);
    if(!candidate.available||!(candidate.c.ready||candidate.c.proposalReady||supplierInvoiceCostDraft(candidate.c)))continue;
    const result=await this.autofill.prepare({consumerUnitId:u.id,month:q.month,requestId:resolutionId(['assisted-autofill-2',t.organizationId,q.month,u.id,candidate.basis]),token:candidate.token},t);
    if(!['PREPARED','PARTIAL'].includes(result.run?.state))throw new ServiceUnavailableException('Preparação dos rascunhos ainda não confirmada. Consulte o histórico antes de repetir.');
    preparedDrafts=true;
   }
  }
  if(preparedDrafts){
   sources=await this.rpc('capture',q,t,null,{});
   const current=sources?.financial?.tables?.consumer_units;
   const scope=(rows:any[])=>rows.map(u=>({id:u.id,organization_id:u.organization_id,customer_id:u.customer_id,status:u.status})).sort((a,b)=>a.id.localeCompare(b.id));
   if(!Array.isArray(current)||autofillHash(scope(current))!==autofillHash(scope(all)))throw new ConflictException('O conjunto de unidades mudou durante a preparação. Consulte os rascunhos antes de continuar.');
  }
  const selected=q.scopeKind==='UNIT'?all.filter((u:any)=>u.id===q.consumerUnitId):all;
  const entries:ClosingEntry[]=[];
  for(const u of [...selected].sort((a,b)=>a.id.localeCompare(b.id))){
   if(u.organization_id!==t.organizationId||u.customer_id!==primary.customer_id)throw new ForbiddenException('Fontes fora do escopo.');
   if(u.status!=='ACTIVE'){entries.push({unitId:u.id,name:u.name??u.id,unavailable:'Unidade inativa exige conferência da cobertura do cliente.'});continue;}
   const c=(!preparedDrafts&&snapshots.get(u.id))||await this.autofill.closingSnapshot({consumerUnitId:u.id,month:q.month},t);
   const comparisonContext=c.available?closingDemandContext(c.c,{...sources.financial.tables,documents:sources.demandDocuments??sources.financial.tables.documents??[]},q.month):null;
   const uncertain=(sources.commercial??[]).some((r:any)=>r.consumer_unit_id===u.id&&['RUNNING','UNKNOWN'].includes(r.state));
   entries.push(c.available?{unitId:u.id,name:u.name??u.id,plan:c.plan,context:comparisonContext,...(this.config.get('EVA_INVOICE_COMPARISON_ENABLED')==='true'?{comparative:(this.config.get('EVA_COMPONENT_TAX_CLOSING_ENABLED')==='true'?invoiceComponentTaxV3:invoiceComparisonV2)(comparisonContext,c.plan,sources.libraries??[])}:{}),...(uncertain?{unavailable:'Há uma reserva de preparação comercial ainda não confirmada. Confira o histórico da origem antes de decidir.'}:{})}:{unitId:u.id,name:u.name??u.id,unavailable:c.observation});
  }
  if(contractClosingDraftEnabled())for(const e of entries){const memory=e.plan?.contractDraft?.memory;if(memory&&!(sources.contractMemories??[]).some((m:any)=>m.id===memory.id&&m.organization_id===t.organizationId&&m.customer_id===primary.customer_id&&m.consumer_unit_id===e.unitId&&autofillHash(m)===memory.hash))throw new ConflictException('A memória contratual mudou durante a captura. Reconfira as fontes antes de preparar.');}
  if(documentedSettlementEnabled())for(const e of entries){const proof=e.context?.documentedSupplierInvoice;if(proof&&!(sources.documentedSupplierDocuments??[]).some((d:any)=>d.id===proof.id&&d.organization_id===t.organizationId&&d.customer_id===primary.customer_id&&d.consumer_unit_id===e.unitId&&d.file_hash===proof.file_hash&&d.file_verified===true&&String(d.reference_month).slice(0,7)===q.month))throw new ConflictException('A nota documentada mudou durante a captura. Reconfira antes de preparar.');}
  if(documentedSettlementEnabled())for(const e of entries){const group=e.context?.contractDraft?.source;if(!group?.invoiceSetHash)continue;if(!supplierInvoiceSetCaptureMatches(group,sources.documentedSupplierDocuments??[],{organizationId:t.organizationId,customerId:primary.customer_id,unitId:e.unitId,month:q.month}))throw new ConflictException('Uma das notas do conjunto mudou durante a captura. Reconfira todas as fontes antes de preparar.');}
  if(q.scopeKind==='UNIT'&&sharedClosingRequired(sources,q.month))entries[0].unavailable='Honorário variável compartilhado: prepare o consolidado do cliente para calcular economia e rateio com todas as unidades.';
  const report=assistedClosingReport(t.organizationId,primary.customer_id,q.month,entries);
  (report as any).documentRequests=closingDocumentRequests(sources,q.month,entries.map(entry=>entry.unitId));
  if(q.scopeKind==='UNIT'){(report as any).scope={kind:'UNIT',unitIds:[q.consumerUnitId]};const unitReport=report.units.find((u:any)=>u.id===q.consumerUnitId);if(unitReport)unitReport.sources.cceeLocal=await closingCceeLocal(this.db.getClient(),t,primary,q.month);}

  if(process.env.EVA_AUTOMATIC_INTAKE_ENABLED==='true'){const refs=await this.db.getClient().rpc('eva_intake_identity_refs',{p_org:t.organizationId,p_sources:report.units.flatMap((u:any)=>{const d=u.sources?.contractDraft?.source,p=u.sources?.supplierInvoiceProposal;return [{id:u.id,documentId:u.documentId,sourceHash:u.sourceHash},...[d,p,...(d?.documents??[]),...(d?.invoices??[]),...(p?.invoices??[])].filter(v=>v?.documentId&&v?.fileHash).map(v=>({id:u.id,documentId:v.documentId,sourceHash:v.fileHash}))];})});if(refs.error)throw new ServiceUnavailableException('Justificativas de identidade indisponíveis; fontes preservadas.');if(refs.data?.length)(report as any).operatorJustificationRefs=refs.data;}
  applyOperationalCceeReview(report,sources);
  report.preparationPolicy=preparationPolicy(report,report.preparationPolicy.reservations);
  const hash=autofillHash(report),basis=autofillHash({version:1,report,sources});
  // A read/recheck without a changed proposal must not create another version.
  // Financial decisions still perform their existing fresh-source checks.
  const latest=rights.rows[0];
  if(latest?.state==='INCOMPLETE'&&latest.payload_hash===hash&&latest.customer_id===primary.customer_id&&latest.month===q.month&&autofillHash(latest.report)===hash)return {row:latest,replayed:true};
  const r=await this.rpc('reserve',q,t,b.requestId,{basis,hash,report,sources});
  if(!r.acquired)return {row:r.row,replayed:true};
  return {row:await this.rpc('finish',q,t,r.row.id,{}),replayed:false};
 }
 async decide(input:any,t:TenantContext){
  const {scopeKind,...b}=input??{};if(scopeKind!==undefined&&!['UNIT','CUSTOMER'].includes(scopeKind))throw new BadRequestException('Escopo inválido.');
  if(!this.enabled())throw new ServiceUnavailableException('Fechamento assistido desligado.');
  if(!b||!['acknowledge,consumerUnitId,decision,hash,id,month,note','acknowledge,consumerUnitId,decision,disclose,hash,id,month,note'].includes(Object.keys(b).sort().join(','))||!uuid(b.id)||typeof b.hash!=='string'||!/^[a-f0-9]{64}$/.test(b.hash)||!['APPROVE','REJECT'].includes(b.decision)||b.acknowledge!==true||typeof b.note!=='string'||b.note.trim().length<20||b.note.length>2000)throw new BadRequestException('Confirme a decisão e sua justificativa.');
  if(b.disclose!==undefined&&typeof b.disclose!=='boolean'||b.decision==='APPROVE'&&this.publicationEnabled()&&b.disclose!==true)throw new BadRequestException('Atualize o relatório e confirme a disponibilização ao cliente.');
  return {row:await this.rpc('decide',this.scope({consumerUnitId:b.consumerUnitId,month:b.month,...(scopeKind?{scopeKind}:{})}),t,b.id,{hash:b.hash,decision:b.decision,note:b.note.trim(),acknowledge:true,...(b.decision==='APPROVE'&&this.publicationEnabled()?{disclose:true}:{})})};
 }
 async publication(input:any,t:TenantContext){
  const {scopeKind,...b}=input??{};if(scopeKind!==undefined&&!['UNIT','CUSTOMER'].includes(scopeKind))throw new BadRequestException('Escopo inválido.');
  if(!this.enabled()||!this.publicationEnabled())throw new ServiceUnavailableException('Divulgação de aprovados desligada.');
  if(!b||Object.keys(b).sort().join(',')!=='acknowledge,action,consumerUnitId,hash,id,month,note'||b.acknowledge!==true||!['publish','withdraw'].includes(b.action)||!uuid(b.id)||typeof b.hash!=='string'||!/^[a-f0-9]{64}$/.test(b.hash)||typeof b.note!=='string'||b.note.trim().length<20||b.note.length>2000)throw new BadRequestException('Confira a divulgação e a justificativa.');
  const q=this.scope({consumerUnitId:b.consumerUnitId,month:b.month,...(scopeKind?{scopeKind}:{})}),h=await this.rpc('history',q,t,null,{page:0});
  if(!h.canManage)throw new ForbiddenException('Divulgação restrita ao gestor autorizado.');
  const r={data:await this.rpc(b.action,q,t,b.id,{hash:b.hash,note:b.note.trim()}),error:null};
  return {publication:r.data};
 }

}
