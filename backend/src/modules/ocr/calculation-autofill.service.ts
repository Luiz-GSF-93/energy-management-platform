import {cceeCostEstimate,cceeEstimateEnabled} from './ccee-cost-estimate';
import {documentedSettlementEnabled} from './documented-tariff-period';
import {documentedSupplierSettlement,settlementHash} from './documented-supplier-settlement';
import {SourcePreparationService} from './source-preparation.service';
import {contractClosingDraft,contractClosingDraftEnabled,contractClosingDraftApplicable} from './contract-closing-draft';
import {commercialProposal,ManualCommercial} from './calculation-autofill-manual';
import {previousCalculationReference} from './calculation-autofill-reference';
import {CalculationParametersService} from '../contracts/services/parameters.service';
import {selectAutofillLibrary} from './calculation-autofill.model';
import {resolutionId} from './ocr-resolution-plan';
import {BadRequestException,ConflictException,ForbiddenException,Injectable,ServiceUnavailableException} from '@nestjs/common';
import {ConfigService} from '@nestjs/config';
import {SupabaseService} from '../../services/supabase.service';
import {LicensesService} from '../licenses/services/licenses.service';
import {TenantContext} from '../../common/interfaces/tenant-context.interface';
import {PERMISSIONS as P} from '../../common/constants/permissions';
import {OcrResolutionService} from './ocr-resolution.service';
import {ocrDraftRole,ocrDraftPermission} from './ocr-draft-access';
import {autofillHash,calculationAutofillPlan} from './calculation-autofill.model';
import {monthPeriod} from '../contracts/services/preparation';
import {MonthlyInputsService} from '../contracts/services/monthly-inputs.service';

const uuid=(x:unknown)=>typeof x==='string'&&/^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(x);
@Injectable()
export class CalculationAutofillService{
 constructor(private db:SupabaseService,private licenses:LicensesService,private resolution:OcrResolutionService,private config:ConfigService,private inputs:MonthlyInputsService,private parameters?:CalculationParametersService,private sourcePreparation?:SourcePreparationService){}
 private enabled(){return this.config.get('CALCULATION_AUTOFILL_ENABLED')==='true';}
 private canWrite(t:TenantContext){return ocrDraftRole(t)&&ocrDraftPermission(t)&&t.permissions.includes(P.ENERGIA_OCR_PROCESS);}
 private async allowed(t:TenantContext,write=false){
  if(!t?.userId||!t.organizationId||(t.scope as string)==='global'||(!['admin_org','gestor','operacional'].includes(t.role)&&t.accessMode!=='platform_operation')||![P.DOCUMENTS_VIEW,P.ORGANIZATION_CONTRACTS_VIEW].every(p=>t.permissions?.includes(p))||write&&!this.canWrite(t))throw new ForbiddenException('Preparação restrita ao backoffice autorizado da organização.');
  await this.licenses.requireEntitlement(t.organizationId,'free_market_management');await this.licenses.requireEntitlement(t.organizationId,'document_management');
 }
 private query(q:Record<string,unknown>){if(!q||Object.keys(q).sort().join(',')!=='consumerUnitId,month'||!uuid(q.consumerUnitId)||typeof q.month!=='string'||!/^(20|21)\d{2}-(0[1-9]|1[0-2])$/.test(q.month))throw new BadRequestException('Selecione unidade e competência válidas.');return {unit:q.consumerUnitId as string,month:q.month};}
 private fail(r:any){if(!r?.error&&r?.data!==null&&r?.data!==undefined)return r.data;if(r?.error?.code==='42501')throw new ForbiddenException('Contexto ou acesso da preparação indisponível.');if(['23505','40001'].includes(r?.error?.code))throw new ConflictException('Fontes ou execução mudaram. Reconfira o histórico.');throw new ServiceUnavailableException('Resultado não confirmado. Consulte o histórico antes de repetir.');}
 private async savedCommercial(scope:{unit:string;month:string},document:{id:string;file_hash:string},customer:string,t:TenantContext){
  const history=await this.rpc('history',scope,t,null,{page:0});
  if(!Array.isArray(history?.rows))throw new ServiceUnavailableException('Histórico comercial indisponível.');
  const row=history.rows[0];if(!row)return null;
  if(row.organization_id!==t.organizationId||row.customer_id!==customer||row.consumer_unit_id!==scope.unit||row.month!==scope.month)throw new ConflictException('Histórico fora do escopo da preparação.');
  if(!['PREPARED','PARTIAL','RUNNING','UNKNOWN'].includes(row.state)||row.document_id!==document.id||row.source_hash!==document.file_hash||!row.plan?.manualOverrides||!Object.keys(row.plan.manualOverrides).length)return null;
  return {values:this.manual(row.plan.manualOverrides),author:row.plan.manualAuthor||row.actor_id};
 }
 private async context(q:Record<string,unknown>,t:TenantContext,manual?:ManualCommercial){
  const {unit,month}=this.query(q),db=this.db.getClient(),period=monthPeriod(month);
  await this.rpc('access',{unit,month},t,null,{});
  const u=this.fail(await db.from('consumer_units').select('*').eq('id',unit).eq('organization_id',t.organizationId).maybeSingle());
  const customer=this.fail(await db.from('customers').select('id,status').eq('id',u.customer_id).eq('organization_id',t.organizationId).is('deleted_at',null).maybeSingle());
  if(u.status!=='ACTIVE'||customer.status!=='ACTIVE')throw new ConflictException('Unidade ou cliente inativo.');
  const docs=await db.from('eva_operational_invoices').select('id,file_hash,file_verified,reference_month').eq('organization_id',t.organizationId).eq('customer_id',u.customer_id).eq('consumer_unit_id',unit).eq('document_type','INVOICE_DISTRIBUTOR').gte('reference_month',period.start).lte('reference_month',period.end).order('id').limit(101);
  if(docs.error||!Array.isArray(docs.data)||docs.data.length>100)throw new ServiceUnavailableException('Não foi possível conferir as faturas completas.');
  if(docs.data.length!==1||!docs.data[0].file_verified||!/^[a-f0-9]{64}$/.test(docs.data[0].file_hash??''))return {available:false as const,unit,month,observation:docs.data.length>1?'Há mais de uma fatura nesta unidade e competência; conferir o vínculo correto.':'É necessária uma fatura verificada nesta unidade e competência.'};
  const libraries:any[]=[];for(let offset=0;offset<10000;offset+=200){const r=await db.from('tariff_library_versions').select('*').eq('organization_id',t.organizationId).order('id').range(offset,offset+199);if(r.error||!Array.isArray(r.data))throw new ServiceUnavailableException('Biblioteca indisponível.');libraries.push(...r.data);if(r.data.length<200)break;if(offset===9800)throw new ServiceUnavailableException('Biblioteca extensa; nenhuma seleção parcial.');}
  const c:any=await this.resolution.preparationSnapshot(docs.data[0].id,t);
  if(c.unit.id!==unit||c.unit.organization_id!==t.organizationId||c.unit.customer_id!==u.customer_id||c.month!==month||c.document.file_hash!==docs.data[0].file_hash||autofillHash(c.unit)!==autofillHash(u))throw new ConflictException('O vínculo ou arquivo mudou durante a consulta.');
  const historical=await db.from('monthly_energy_settlements').select('id,organization_id,customer_id,consumer_unit_id,month,status,validation_status,approved_at,published_at,version_number,financial_format,financial_hash').eq('organization_id',t.organizationId).eq('customer_id',u.customer_id).eq('consumer_unit_id',unit).eq('financial_format','financial-settlement-1.0').in('status',['APPROVED','PUBLISHED']).eq('validation_status','VALIDATED').not('approved_at','is',null).lt('month',period.start).order('month',{ascending:false}).order('version_number',{ascending:false}).limit(101);
  if(historical.error||!Array.isArray(historical.data)||historical.data.length>100)throw new ServiceUnavailableException('Histórico anterior indisponível; nenhuma referência parcial.');
  const units=await db.from('consumer_units').select('id,status').eq('organization_id',t.organizationId).eq('customer_id',u.customer_id).limit(101);
  if(units.error||!Array.isArray(units.data)||units.data.length>100)throw new ServiceUnavailableException('Unidades indisponíveis para conferir rateio.');
  let prior=null;
  if(historical.data.length){const top=historical.data[0];if(historical.data.some((r:any)=>r.id!==top.id&&r.month===top.month&&r.version_number===top.version_number))throw new ConflictException('Fechamento anterior ambíguo.');const row=await db.from('monthly_energy_settlements').select('*').eq('organization_id',t.organizationId).eq('customer_id',u.customer_id).eq('consumer_unit_id',unit).eq('id',top.id).maybeSingle();if(row.error||!row.data||row.data.financial_hash!==top.financial_hash)throw new ConflictException('Fechamento anterior mudou durante a consulta.');prior=previousCalculationReference([row.data],u,month);if(!prior)throw new ServiceUnavailableException('Integridade do fechamento anterior requer conferência.');}
  c.reference=prior;c.customerUnits=units.data;
  if(cceeEstimateEnabled()){
   const months=[...new Set<string>(historical.data.map((r:any)=>String(r.month).slice(0,7)))].filter(m=>Number(month.slice(0,4))*12+Number(month.slice(5))-Number(m.slice(0,4))*12-Number(m.slice(5))<=6);
   const history:any[]=[];
   for(const m of months){const candidates=historical.data.filter((r:any)=>String(r.month).slice(0,7)===m),top=candidates[0];if(candidates.filter((r:any)=>r.version_number===top.version_number).length!==1)continue;const r=await db.from('monthly_energy_settlements').select('*').eq('organization_id',t.organizationId).eq('customer_id',u.customer_id).eq('consumer_unit_id',unit).eq('id',top.id).maybeSingle();if(r.error||!r.data||r.data.financial_hash!==top.financial_hash)throw new ConflictException('Histórico CCEE mudou durante a preparação.');history.push(r.data);}
   const previous=Array.from({length:6},(_,i)=>{const n=Number(month.slice(0,4))*12+Number(month.slice(5))-i-2;return String(Math.floor(n/12))+'-'+String(n%12+1).padStart(2,'0');});
   const closingRpc=contractClosingDraftEnabled()?(documentedSettlementEnabled()?'eva_documented_closing_action':'eva_contract_closing_action'):'eva_assisted_closing_action';
   const closingHistory=await Promise.all(previous.map(async m=>{
    const args={p_org:t.organizationId,p_actor:t.userId,p_role:t.roleId,p_platform:t.accessMode==='platform_operation',p_action:'history',...(contractClosingDraftEnabled()?{p_disclose:false}:{}),p_unit:unit,p_month:m,p_id:null};
    const rows:any[]=[];
    for(let page=0;page<10;page++){const h=this.fail(await db.rpc(closingRpc,{...args,p_body:{page}}));if(!Array.isArray(h.rows)||!Number.isInteger(h.total)||h.total>100)throw new ServiceUnavailableException('Histórico CCEE aprovado incompleto.');if(h.rows.some((r:any)=>r.organization_id!==t.organizationId||r.customer_id!==u.customer_id||r.month!==m))throw new ConflictException('Histórico CCEE fora do escopo.');rows.push(...h.rows);if(rows.length>=h.total)break;if(!h.rows.length||page===9)throw new ServiceUnavailableException('Histórico CCEE truncado.');}
    return rows.map(r=>({...r,evidenceFormat:'EVA_APPROVED',version_number:r.version}));
   }));
   history.push(...closingHistory.flat());
   c.cceeEstimate=cceeCostEstimate(history,u,month,c.cost?.costs?.items??[],c.cost?.costs?.noCosts===true);
  }
  let restored:any=null;
  if(manual===undefined)restored=await this.savedCommercial({unit,month},c.document,u.customer_id,t);
  c.manualOverrides=manual??restored?.values??{};c.manualAuthor=manual?t.userId:restored?.author??null;
  c.libraryRecord=selectAutofillLibrary(libraries,u,month).record;
  c.sourcePreparation=await this.sourcePreparation?.inspect(c)??null;
  if(contractClosingDraftEnabled()&&contractClosingDraftApplicable(c)){
   c.indexMemories=[];
   const contracts=(c.captured.contracts??[]).filter((r:any)=>r.organization_id===t.organizationId&&r.customer_id===u.customer_id&&r.consumer_unit_id===unit&&r.contract_type==='ENERGY_PURCHASE'&&['ACTIVE','APPROVED'].includes(r.status)&&String(r.start_date).slice(0,10)<=period.start&&String(r.end_date).slice(0,10)>=period.end);
   if(contracts.length===1){
    const h=this.fail(await db.rpc('contract_index_memory_action',{p_org:t.organizationId,p_actor:t.userId,p_role:t.roleId,p_platform:t.accessMode==='platform_operation',p_contract:contracts[0].id,p_action:'history',p_id:null,p_body:{}}));
    if(!Array.isArray(h.rows)||autofillHash(h.contract)!==autofillHash(contracts[0])||h.rows.some((m:any)=>m.organization_id!==t.organizationId||m.contract_id!==contracts[0].id||m.customer_id!==u.customer_id||m.consumer_unit_id!==unit))throw new ConflictException('As fontes da memória contratual mudaram. Reconfira a competência.');
    c.indexMemories=h.rows;
   }
   c.contractDraft=contractClosingDraft(c,c.indexMemories);
  }
  if(documentedSettlementEnabled()){
   const r=await db.from('documents').select('id,file_hash,original_filename,reference_month,file_verified').eq('organization_id',t.organizationId).eq('customer_id',u.customer_id).eq('consumer_unit_id',unit).eq('document_type','INVOICE_SUPPLIER').gte('reference_month',period.start).lte('reference_month',period.end).limit(101);
   if(r.error||!Array.isArray(r.data)||r.data.length>100)throw new ServiceUnavailableException('Notas da competência indisponíveis.');
   c.documentedSupplierOptions={enabled:true,documents:r.data.filter((d:any)=>d.file_verified&&/^[a-f0-9]{64}$/.test(d.file_hash??'')),cost:c.cost?{id:c.cost.id,revision:c.cost.revision,hash:settlementHash(c.cost.costs),items:c.cost.costs.items}:null};
   if(cceeEstimateEnabled()&&this.sourcePreparation&&c.documentedSupplierOptions.documents.length===1&&!c.manualOverrides.supplierSettlement){
    const d=c.documentedSupplierOptions.documents[0];
    try{c.supplierInvoiceProposal=await this.sourcePreparation.supplierProposal(c,d.id,d.file_hash);}catch{c.supplierInvoiceProposal=null;c.proposalObservations=[...(c.proposalObservations??[]),'Nota do fornecedor: extração local exige revisão; sem nova chamada paga.'];}
   }
   const v=c.manualOverrides.supplierSettlement;
   if(v){
    if(!this.sourcePreparation)throw new ServiceUnavailableException('Verificação documental indisponível.');
    try{c.documentedSupplierInvoice=await this.sourcePreparation.verifiedSupplierInvoice(c,v.documentId,v.fileHash);}catch{c.documentedSupplierInvoice=null;}
    const prior=c.contractDraft,regular=prior?.memory&&prior?.source&&prior?.supplier?.pricePerMwh?{price:prior.supplier.pricePerMwh,contractedMwh:prior.supplier.contractedMwh,contract:prior.supplier.contract,minimum:prior.supplier.minMwh,maximum:prior.supplier.maxMwh,source:prior.source,memory:prior.memory}:undefined;
    c.contractDraft=documentedSupplierSettlement(c,regular);
   }
  }
  const plan=calculationAutofillPlan(c,libraries);
  // External sources identify one preparation. Existing manual drafts are not overwritten on replay.
  const basis=autofillHash({cceeEstimate:c.cceeEstimate??null,supplierInvoiceProposal:c.supplierInvoiceProposal??null,v:documentedSettlementEnabled()?6:5,...(contractClosingDraftEnabled()?{contractDraft:c.contractDraft,indexMemories:c.indexMemories}:{}),...(c.sourcePreparation?{sourcePreparation:c.sourcePreparation}:{}),...(documentedSettlementEnabled()?{documentedInvoice:c.documentedSupplierInvoice??null}:{}),manual:c.manualOverrides,manualAuthor:c.manualAuthor,reference:c.reference?{id:c.reference.id,hash:c.reference.hash}:null,customerUnits:c.customerUnits,document:c.document,evidence:c.evidenceToken,unit:c.unit,contracts:c.captured.contracts,prices:c.captured.prices,management:c.captured.management,adjustments:c.captured.adjustments,feeRules:c.captured.feeRules,billingRules:c.captured.billingRules,approvedParameters:c.captured.parameters.filter((p:any)=>p.status==='APPROVED'),validatedMonthly:c.captured.monthly.filter((p:any)=>p.status==='VALIDATED'),validatedCosts:c.captured.monthlyCosts.filter((p:any)=>p.status==='VALIDATED'),libraries});
  const token=autofillHash({basis,actor:t.userId,plan,resolution:c.token});
  return {available:true as const,unit,month,documentId:c.document.id,sourceHash:c.document.file_hash,basis,token,c,plan};
 }
 private output(c:Awaited<ReturnType<CalculationAutofillService['context']>>,t:TenantContext){if(!c.available)return {enabled:true,available:false,percent:0,canPrepare:false,observations:[c.observation],unitId:c.unit,month:c.month};return {enabled:true,available:true,unitId:c.unit,month:c.month,documentId:c.documentId,sourceHash:c.sourceHash,basis:c.basis,token:c.token,canPrepare:this.canWrite(t),...c.plan};}
 async closingSnapshot(q:Record<string,unknown>,t:TenantContext){await this.allowed(t);if(!this.enabled())throw new ServiceUnavailableException('Preparação automática indisponível.');return this.context(q,t);}
 async inspect(q:Record<string,unknown>,t:TenantContext){if(!this.enabled())return {enabled:false};await this.allowed(t);this.query(q);return this.output(await this.context(q,t),t);}
 private async rpc(action:string,q:{unit:string;month:string},t:TenantContext,run:string|null,body:any){return this.fail(await this.db.getClient().rpc('calculation_autofill_action',{p_org:t.organizationId,p_actor:t.userId,p_role:t.roleId,p_platform:t.accessMode==='platform_operation',p_action:action,p_unit:q.unit,p_month:q.month,p_run:run,p_body:body}));}
 private manual(value:unknown){try{const parsed=commercialProposal(value);if(parsed.supplierSettlement&&!documentedSettlementEnabled())throw Error('Conciliação documentada ainda desligada.');return parsed;}catch(e){throw new BadRequestException(e instanceof Error?e.message:'Valores comerciais inválidos.');}}
 async preview(body:any,t:TenantContext){await this.allowed(t,true);if(!this.enabled())throw new ServiceUnavailableException('Preenchimento automático desligado.');if(!body||Object.keys(body).sort().join(',')!=='consumerUnitId,manual,month')throw new BadRequestException('Proposta inválida.');const q={consumerUnitId:body.consumerUnitId,month:body.month};this.query(q);return this.output(await this.context(q,t,this.manual(body.manual)),t);}
 async history(q:Record<string,unknown>,t:TenantContext){await this.allowed(t);if(!this.enabled())return {enabled:false};const {page='0',...scope}=q;if(typeof page!=='string'||!/^\d{1,3}$/.test(page))throw new BadRequestException('Página inválida.');return this.rpc('history',this.query(scope),t,null,{page:Number(page)});}
 async prepare(body:any,t:TenantContext){
  await this.allowed(t,true);if(!this.enabled())throw new ServiceUnavailableException('Preenchimento automático desligado.');
  if(!body||!['consumerUnitId,month,requestId,token','consumerUnitId,manual,month,requestId,token'].includes(Object.keys(body).sort().join(','))||!uuid(body.requestId)||typeof body.token!=='string'||!/^[a-f0-9]{64}$/.test(body.token))throw new BadRequestException('Preparação inválida.');
  const manual=body.manual===undefined?undefined:this.manual(body.manual);
  const q={consumerUnitId:body.consumerUnitId,month:body.month},scope=this.query(q),c=await this.context(q,t,manual);
  if(!c.available||c.token!==body.token)throw new ConflictException('Atualize as fontes antes de preparar.');
  const reserved=await this.rpc('reserve',scope,t,body.requestId,{basis:c.basis,documentId:c.documentId,sourceHash:c.sourceHash,plan:c.plan});
  if(!reserved.acquired)return {run:reserved.run,replayed:true,current:this.output(c,t),canPublish:false};
  let receipts:any[]=[],status=c.plan.pending||!c.c.ready?'PARTIAL':'PREPARED';
  try{
   // Reserve is persisted BEFORE any legacy write; unknown results can only be reconciled by GET.
   const fresh=await this.context(q,t,manual);if(!fresh.available||fresh.token!==c.token)throw new ConflictException('Sources changed');
   if((c.c.ready||c.c.proposalReady)&&(c.c.resolution.canPrepare||c.c.proposalReady)){
    // Populate the first monthly draft with the proposed measured demand too. Never edit an existing draft.
    if(!c.c.input){
     const measurements={...c.c.measurements};const demand=c.plan.fields.find(f=>f.key==='demandSingle');
     if(demand?.state==='FILLED'&&typeof demand.value==='string')measurements.demandSingle=demand.value;
     const saved=await this.inputs.create({consumerUnitId:scope.unit,month:scope.month,measurements,billedDemand:c.c.billed,sourceReference:'EVA · '+c.documentId+' · '+c.sourceHash,notes:'Preenchimento automático proposto; sem confirmação humana ou validação financeira.',correctionReason:'Proposta inicial a partir da evidência da competência.'},t);
     receipts.push({label:'Dados mensais preenchidos em rascunho',state:'SAVED_DRAFT',id:saved.id});
    }
    const current=await this.context(q,t,manual);if(!current.available||current.basis!==c.basis)throw new ConflictException('Sources changed');
    const r=await (current.c.ready?this.resolution.prepare(c.documentId,t,{token:current.c.token}):this.resolution.prepareProposals(c.documentId,t,{token:current.c.token}));receipts.push(...r.receipts);if(receipts.some((x:any)=>x.state==='VERIFY_REQUIRED'))status='PARTIAL';
   }
   if(this.parameters&&c.c.libraryRecord&&(c.c.ready||c.c.proposalReady)){
    const lib=c.c.libraryRecord;
    for(const item of lib.profile.items){
     const existing=c.c.captured.parameters.filter((p:any)=>p.scenario==='ACR'&&p.kind==='TARIFF'&&p.component_code===item.component&&p.time_band===item.band&&p.status!=='RETIRED'&&String(p.start_date).slice(0,10)<=scope.month+'-31'&&String(p.end_date).slice(0,10)>=scope.month+'-01');
     if(existing.length)continue;
     const saved=await this.parameters.createPrepared(resolutionId(['autofill-acr-v2',t.organizationId,c.documentId,c.sourceHash,lib.id,item.component,item.band]),{consumerUnitId:scope.unit,kind:'TARIFF',componentCode:item.component,label:item.label,scenario:'ACR',timeBand:item.band,measure:item.measure,amount:item.value,treatment:'NET',embeddedTaxCodes:[],includedTaxes:'',baseRule:'',direction:'DEBIT',source:'Biblioteca '+lib.id+' v'+lib.version+' · '+lib.profile.source,notes:'Proposta EVA a conferir: tarifa-base da biblioteca; incidência e bases tributárias exigem conferência específica. Não é aprovação.',startDate:c.c.period.start,endDate:c.c.period.end},t.organizationId,t.userId);receipts.push({label:'ACR · '+item.label+' em rascunho para conferência',state:'SAVED_DRAFT',id:saved.id});
    }
   }
   const after=await this.context(q,t,manual);
   if(!after.available||after.basis!==c.basis){status='PARTIAL';receipts.push({label:'Fonte alterada durante a preparação; revisão necessária',state:'VERIFY_REQUIRED'});}
   else status=(after.c.ready||after.c.proposalReady)&&after.plan.readyForValidation&&!receipts.some((r:any)=>r.state==='VERIFY_REQUIRED')?'PREPARED':'PARTIAL';
   const run=await this.rpc('finish',scope,t,reserved.run.id,{status,receipts});
   return {run,current:this.output(after,t),canPublish:false};
  }catch{
   // Never repeat a side effect here. A failed finish leaves the durable RUNNING reservation visible.
   try{await this.rpc('finish',scope,t,reserved.run.id,{status:'UNKNOWN',receipts:[...receipts,{label:'Etapa não confirmada; consultar histórico',state:'VERIFY_REQUIRED'}]});}catch{/* durable reservation retained */}
   throw new ServiceUnavailableException('Preparação não confirmada. Consulte o histórico; não será repetida automaticamente.');
  }
 }
}
