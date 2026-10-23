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
 constructor(private db:SupabaseService,private config:ConfigService,private autofill:CalculationAutofillService){}
 private publicationEnabled(){return process.env.EVA_APPROVED_PUBLICATIONS_ENABLED==='true'&&process.env.EVA_APPROVED_PORTAL_ENABLED==='true';}
 private enabled(){return this.config.get('EVA_ASSISTED_CLOSING_ENABLED')==='true';}
 private scope(q:any){if(!q||Object.keys(q).sort().join(',')!=='consumerUnitId,month'||!uuid(q.consumerUnitId)||typeof q.month!=='string'||!/^(20|21)\d{2}-(0[1-9]|1[0-2])$/.test(q.month))throw new BadRequestException('Unidade e competência inválidas.');return q;}
 private async rpc(action:string,q:any,t:TenantContext,id:string|null,body:any){
  if(!t?.organizationId||!t.userId||!t.roleId)throw new ForbiddenException('Contexto organizacional necessário.');
  const disclose=action==='decide'&&this.publicationEnabled()&&body.disclose===true;
  const contractDraft=contractClosingDraftEnabled();
  const documented=documentedSettlementEnabled()&&contractDraft;
  const r=await this.db.getClient().rpc(documented?'eva_documented_closing_action':contractDraft?'eva_contract_closing_action':disclose?'decide_eva_with_publication':'eva_assisted_closing_action',{p_org:t.organizationId,p_actor:t.userId,p_role:t.roleId,p_platform:t.accessMode==='platform_operation',...(!disclose||contractDraft?{p_action:action}:{}),...(contractDraft?{p_disclose:disclose}:{}),p_unit:q.consumerUnitId,p_month:q.month,p_id:id,p_body:body});
  if(!r.error&&r.data!=null)return r.data;
  if(r.error?.code==='42501')throw new ForbiddenException('Acesso restrito ao backoffice autorizado.');
  if(['23505','40001'].includes(r.error?.code))throw new ConflictException('As fontes ou a decisão mudaram. Atualize o histórico antes de continuar.');
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
 async prepare(b:any,t:TenantContext){
  if(!this.enabled())throw new ServiceUnavailableException('Fechamento assistido desligado.');
  if(!b||Object.keys(b).sort().join(',')!=='consumerUnitId,month,requestId'||!uuid(b.requestId))throw new BadRequestException('Preparação inválida.');
  const q=this.scope({consumerUnitId:b.consumerUnitId,month:b.month});
  const rights=await this.rpc('history',q,t,null,{page:0});if(!rights.canPrepare)throw new ForbiddenException('Sem permissão para preparar.');
  const prior=rights.rows.find((r:any)=>r.id===b.requestId);if(prior)return {row:prior,replayed:true};
  let sources=await this.rpc('capture',q,t,null,{});const all=sources?.financial?.tables?.consumer_units;
  if(!Array.isArray(all)||!all.length||all.length>100||new Set(all.map((u:any)=>u.id)).size!==all.length)throw new ConflictException('Conjunto completo de unidades indisponível.');
  const primary=all.find((u:any)=>u.id===q.consumerUnitId);if(!primary)throw new ForbiddenException('Unidade fora do escopo.');
  // Check every unit before the first draft write, including inactive units.
  if(all.some((u:any)=>u.organization_id!==t.organizationId||u.customer_id!==primary.customer_id))throw new ForbiddenException('Fontes fora do escopo.');
  const snapshots=new Map<string,any>();let preparedDrafts=false;
  if(this.config.get('CALCULATION_AUTOFILL_ENABLED')==='true'&&ocrDraftRole(t)&&ocrDraftPermission(t)&&t.permissions?.includes(P.ENERGIA_OCR_PROCESS)){
   for(const u of [...all].sort((a,b)=>a.id.localeCompare(b.id))){
    if(u.status!=='ACTIVE'||(sources.commercial??[]).some((r:any)=>r.consumer_unit_id===u.id&&['RUNNING','UNKNOWN'].includes(r.state)))continue;
    const candidate=await this.autofill.closingSnapshot({consumerUnitId:u.id,month:q.month},t);snapshots.set(u.id,candidate);
    if(!candidate.available||!(candidate.c.ready||candidate.c.proposalReady))continue;
    const result=await this.autofill.prepare({consumerUnitId:u.id,month:q.month,requestId:resolutionId(['assisted-autofill-1',t.organizationId,b.requestId,u.id,candidate.basis]),token:candidate.token},t);
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
  const entries:ClosingEntry[]=[];
  for(const u of [...all].sort((a,b)=>a.id.localeCompare(b.id))){
   if(u.organization_id!==t.organizationId||u.customer_id!==primary.customer_id)throw new ForbiddenException('Fontes fora do escopo.');
   if(u.status!=='ACTIVE'){entries.push({unitId:u.id,name:u.name??u.id,unavailable:'Unidade inativa exige conferência da cobertura do cliente.'});continue;}
   const c=(!preparedDrafts&&snapshots.get(u.id))||await this.autofill.closingSnapshot({consumerUnitId:u.id,month:q.month},t);
   const uncertain=(sources.commercial??[]).some((r:any)=>r.consumer_unit_id===u.id&&['RUNNING','UNKNOWN'].includes(r.state));
   entries.push(c.available?{unitId:u.id,name:u.name??u.id,plan:c.plan,context:c.c,...(this.config.get('EVA_INVOICE_COMPARISON_ENABLED')==='true'?{comparative:(this.config.get('EVA_COMPONENT_TAX_CLOSING_ENABLED')==='true'?invoiceComponentTaxV3:invoiceComparisonV2)(c.c,c.plan,sources.libraries??[])}:{}),...(uncertain?{unavailable:'Há uma reserva de preparação comercial ainda não confirmada. Confira o histórico da origem antes de decidir.'}:{})}:{unitId:u.id,name:u.name??u.id,unavailable:c.observation});
  }
  if(contractClosingDraftEnabled())for(const e of entries){const memory=e.plan?.contractDraft?.memory;if(memory&&!(sources.contractMemories??[]).some((m:any)=>m.id===memory.id&&m.organization_id===t.organizationId&&m.customer_id===primary.customer_id&&m.consumer_unit_id===e.unitId&&autofillHash(m)===memory.hash))throw new ConflictException('A memória contratual mudou durante a captura. Reconfira as fontes antes de preparar.');}
  if(documentedSettlementEnabled())for(const e of entries){const proof=e.context?.documentedSupplierInvoice;if(proof&&!(sources.documentedSupplierDocuments??[]).some((d:any)=>d.id===proof.id&&d.organization_id===t.organizationId&&d.customer_id===primary.customer_id&&d.consumer_unit_id===e.unitId&&d.file_hash===proof.file_hash&&d.file_verified===true&&String(d.reference_month).slice(0,7)===q.month))throw new ConflictException('A nota documentada mudou durante a captura. Reconfira antes de preparar.');}
  const report=assistedClosingReport(t.organizationId,primary.customer_id,q.month,entries),hash=autofillHash(report),basis=autofillHash({version:1,report,sources});
  const r=await this.rpc('reserve',q,t,b.requestId,{basis,hash,report,sources});
  if(!r.acquired)return {row:r.row,replayed:true};
  return {row:await this.rpc('finish',q,t,r.row.id,{}),replayed:false};
 }
 async decide(b:any,t:TenantContext){
  if(!this.enabled())throw new ServiceUnavailableException('Fechamento assistido desligado.');
  if(!b||!['acknowledge,consumerUnitId,decision,hash,id,month,note','acknowledge,consumerUnitId,decision,disclose,hash,id,month,note'].includes(Object.keys(b).sort().join(','))||!uuid(b.id)||typeof b.hash!=='string'||!/^[a-f0-9]{64}$/.test(b.hash)||!['APPROVE','REJECT'].includes(b.decision)||b.acknowledge!==true||typeof b.note!=='string'||b.note.trim().length<20||b.note.length>2000)throw new BadRequestException('Confirme a decisão e sua justificativa.');
  if(b.disclose!==undefined&&typeof b.disclose!=='boolean'||b.decision==='APPROVE'&&this.publicationEnabled()&&b.disclose!==true)throw new BadRequestException('Atualize o relatório e confirme a disponibilização ao cliente.');
  return {row:await this.rpc('decide',this.scope({consumerUnitId:b.consumerUnitId,month:b.month}),t,b.id,{hash:b.hash,decision:b.decision,note:b.note.trim(),acknowledge:true,...(b.decision==='APPROVE'&&this.publicationEnabled()?{disclose:true}:{})})};
 }
 async publication(b:any,t:TenantContext){
  if(!this.enabled()||!this.publicationEnabled())throw new ServiceUnavailableException('Divulgação de aprovados desligada.');
  if(!b||Object.keys(b).sort().join(',')!=='acknowledge,action,consumerUnitId,hash,id,month,note'||b.acknowledge!==true||!['publish','withdraw'].includes(b.action)||!uuid(b.id)||typeof b.hash!=='string'||!/^[a-f0-9]{64}$/.test(b.hash)||typeof b.note!=='string'||b.note.trim().length<20||b.note.length>2000)throw new BadRequestException('Confira a divulgação e a justificativa.');
  const q=this.scope({consumerUnitId:b.consumerUnitId,month:b.month}),h=await this.rpc('history',q,t,null,{page:0});
  if(!h.canManage)throw new ForbiddenException('Divulgação restrita ao gestor autorizado.');
  const r=await this.db.getClient().rpc(documentedSettlementEnabled()&&contractClosingDraftEnabled()?'eva_documented_closing_action':contractClosingDraftEnabled()?'eva_contract_closing_action':'eva_closing_publication_action',{...(contractClosingDraftEnabled()?{p_disclose:false}:{}),p_org:t.organizationId,p_actor:t.userId,p_role:t.roleId,p_platform:t.accessMode==='platform_operation',p_action:b.action,p_unit:q.consumerUnitId,p_month:q.month,p_id:b.id,p_body:{hash:b.hash,note:b.note.trim()}});
  if(r.error?.code==='42501')throw new ForbiddenException('Acesso à divulgação indisponível.');if(r.error)throw new ConflictException('Divulgação não confirmada. Confira o histórico e a versão aprovada.');return {publication:r.data};
 }

}
