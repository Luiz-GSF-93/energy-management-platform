import {BotEnergyLicenseService} from './bot-energy-license.service';
import {BotEnergyBudgetService} from './bot-energy-budget.service';
import {Injectable,Optional} from '@nestjs/common';
import {createHash,randomUUID} from 'node:crypto';
import {TenantContext} from '../../common/interfaces/tenant-context.interface';
import {PERMISSIONS as P} from '../../common/constants/permissions';
import {AuditService} from '../../common/services/audit.service';
import {AiEvidence,AI_PROMPT_VERSION,AzureBackofficeAiConnector,BackofficeAiError} from './azure-backoffice-ai.connector';

export type AiReview={state:'READY'|'NOT_CONFIGURED'|'NOT_AUTHORIZED'|'FAILED'|'NO_EVIDENCE';message:string;answer?:string;fields?:{key:string;value:string;evidenceId:string}[];doubts?:{question:string;evidenceIds:string[]}[];evidence?:AiEvidence[];model?:string;promptVersion?:string;checkedAt:string};
@Injectable()
export class BackofficeAiService {
 private readonly active=new Set<string>();
 private readonly recent=new Map<string,number[]>();
 constructor(private connector:AzureBackofficeAiConnector,private audit:AuditService,@Optional() private budget?:BotEnergyBudgetService,@Optional() private licenses?:BotEnergyLicenseService){}
 async available(t:TenantContext){return !!t.organizationId&&!!t.userId&&(t.scope as string)!=='global'&&(['operacional','gestor','admin_org'].includes(t.role)||t.accessMode==='platform_operation')&&t.permissions.includes(P.INTELLIGENCE_AI_USE)&&this.connector.available(t.organizationId)&&(process.env.BOT_ENERGY_LICENSE_MODE!=='true'||!!this.licenses&&await this.licenses.available(t.organizationId));}
 async interpret(t:TenantContext,question:string,evidence:AiEvidence[],document?:string,module:'OCR'|'BOT_ENERGY'|'CHAT'|'AUDITORIA'|'ANALISES'='OCR'):Promise<AiReview>{
  const checkedAt=new Date().toISOString();
  if(!t.organizationId||!t.userId||(t.scope as string)==='global'||!['operacional','gestor','admin_org'].includes(t.role)&&t.accessMode!=='platform_operation'||!t.permissions.includes(P.INTELLIGENCE_AI_USE))return {state:'NOT_AUTHORIZED',message:'Interpretação generativa disponível somente para o backoffice autorizado.',checkedAt};
  if(!this.connector.available(t.organizationId))return {state:'NOT_CONFIGURED',message:'Azure OpenAI aguardando configuração do recurso e modelo. A leitura OCR e os preenchimentos pelas regras existentes continuam disponíveis.',checkedAt};
  const key=t.organizationId+':'+t.userId,now=Date.now();
  for(const [k,times] of this.recent)if(!times.some(n=>now-n<60000))this.recent.delete(k);
  const times=(this.recent.get(key)??[]).filter(n=>now-n<60000);
  if(this.active.has(key)||times.length>=6||this.active.size>=8||this.recent.size>=1000)return {state:'FAILED',message:'A IA está ocupada. Consulte o status ou tente novamente depois; nenhum valor foi alterado.',checkedAt};
  this.active.add(key);this.recent.set(key,[...times,now]);
  const requestId=randomUUID(),evidenceHash=createHash('sha256').update(JSON.stringify(evidence)).digest('hex');
  const log=async(state:string,extra:Record<string,unknown>={})=>this.audit.logCreate({userId:t.userId,organizationId:t.organizationId,resourceType:'backoffice_ai_interpretation',resourceId:requestId,after:{state,documentId:document??null,promptVersion:AI_PROMPT_VERSION,evidenceHash,questionHash:createHash('sha256').update(question).digest('hex'),...extra}});
  try{
   // Fail closed before transmission if the existing durable audit cannot record intent.
   if(!this.budget)throw new Error('BUDGET_UNAVAILABLE');
   if(process.env.BOT_ENERGY_LICENSE_MODE==='true'&&(!this.licenses||!await this.licenses.available(t.organizationId)))return {state:'NOT_AUTHORIZED',message:'Bot-Energy + RAG não incluído em licença vigente ou cota indisponível.',checkedAt};
   const reservation=await this.budget.reserve(t.organizationId,t.userId,requestId,'conversation',{inputTokens:60000,outputTokens:2200},module);
   await log('REQUESTED');
   const result=await this.connector.interpret(t.organizationId,question,evidence);
   await this.budget.settle(reservation,result.usage);
   await log(result.supported?'READY':'NO_EVIDENCE',{model:result.model,citations:result.citations,fields:result.fields,doubts:result.doubts,answer:result.answer});
   if(!result.supported)return {state:'NO_EVIDENCE',message:'Não há evidência suficiente no contexto autorizado para responder. Nenhum preenchimento foi presumido.',checkedAt};
   return {state:'READY',message:'Interpretação da IA concluída. Confira as fontes; esta interpretação não valida nem aprova financeiramente.',answer:result.answer,fields:result.fields,doubts:result.doubts,evidence:evidence.filter(e=>result.citations.includes(e.id)||result.doubts.some(d=>d.evidenceIds.includes(e.id))),model:result.model,promptVersion:result.promptVersion,checkedAt};
  }catch(error){
   const code=error instanceof BackofficeAiError?error.code:'CONTROL_UNAVAILABLE';
   try{await log('FAILED',{errorCode:code,evidenceCount:evidence.length});}catch{/* Keep source-backed drafts even if diagnostic auditing is unavailable. */}
   const message=code==='PROVIDER_TIMEOUT'?'A IA excedeu o tempo de resposta. Os campos extraídos e rascunhos estão preservados; tente novamente.':error instanceof Error&&error.message.startsWith('Preços Azure')?error.message:'Não foi possível concluir a interpretação com fontes válidas. Os campos extraídos estão preservados. Confira as evidências e tente novamente; aprovação financeira continua separada.';
   return {state:'FAILED',message,checkedAt};
  }
  finally{this.active.delete(key);}
 }
}

// Only allowlisted, already scoped values leave the backend; no raw PDF, credentials,
// signed storage URLs or repository instructions are sent to the model.
export function assistantAiEvidence(plan:any):AiEvidence[]{
 const evidence:AiEvidence[]=[{id:'context',label:'Contexto autorizado',value:`${plan.unitName} · ${plan.month} · ${plan.counts.blockers} bloqueios · ${plan.counts.reviews} revisões. Não comprova publicação.`,source:'Diagnóstico atual do backend'}];
 for(const f of plan.fieldTasks??[])evidence.push({id:'field-'+evidence.length,fieldKey:f.kind+':'+f.key,label:f.label,value:f.value??'Não identificado',source:f.source||'Fonte não identificada'});
 for(const f of plan.findings??[])evidence.push({id:'finding-'+evidence.length,label:f.section+' · '+f.severity,value:f.message,source:'Diagnóstico atual · '+f.code});
 for(const h of plan.comparisons??[])evidence.push({id:'history-'+evidence.length,label:'Histórico da unidade',value:`${h.month} · ${h.state} · ${h.message}`,source:'Registro validado · versão '+h.version});
 for(const c of plan.configurations??[])evidence.push({id:'configuration-'+evidence.length,label:c.label,value:c.state,source:'Vigências e diagnóstico atuais'});
 evidence.push({id:'records',label:'Registros mensais',value:`Dados mensais: ${plan.records.measurements.status}; custos mensais: ${plan.records.costs.status}. Validação não é aprovação financeira.`,source:'Registros atuais da unidade e competência'});
 evidence.push(...financialAiEvidence(plan.financialContext));
 for(const op of plan.operations??[]){
  const financial=op.invoiceAdjustments;if(financial?.state!=='RECONCILED')continue;
  for(const [index,item] of (financial.items??[]).entries()){
   const tax=item.taxEvidence;if(!tax||!['WITH_ICMS','WITHOUT_ICMS'].includes(tax.icms))continue;
   const source=tax.ruleVersion+' · operação OCR '+item.source+' · valor final da fatura, tributos já incluídos; não acrescentar novamente.';
   evidence.push({id:'subsidy-classification-'+index,label:item.label,value:tax.icms==='WITH_ICMS'?'Subvenção TUSD com ICMS; PIS e Cofins também presentes.':'Subvenção TUSD sem ICMS nesta linha; PIS e Cofins presentes. Ausência de ICMS não elimina PIS/Cofins.',source});
   for(const [code,value] of [['ICMS',tax.icmsAmount],['PIS',tax.pisAmount],['COFINS',tax.cofinsAmount]])if(typeof value==='string'&&/^\d+[.]\d{2}$/.test(value))evidence.push({id:'subsidy-tax-'+index+'-'+code,fieldKey:'invoice-tax:'+item.source+':'+code,label:item.label+' · '+code,value,source});
  }
  for(const band of financial.aclCancellation??[])if(['PEAK','OFF_PEAK'].includes(band.period)&&band.balance==='0.00')evidence.push({id:'acl-cancellation-'+band.period,label:'Energia ACL e desconto · '+(band.period==='PEAK'?'ponta':'fora ponta'),value:`Lançamento positivo R$ ${band.charge}; desconto negativo R$ ${band.credit}; saldo R$ 0,00. O par não é nova despesa e não é base de ICMS adicional da distribuidora. ${band.icmsState==='ZERO_NET'?'ICMS explicitamente conciliado com saldo zero.':'Não há ICMS mostrado nessas linhas; isso não declara isenção geral.'} A nota do fornecedor é uma fonte separada e conserva seu próprio tratamento tributário.`,source:'Conciliação monetária OCR por posto · '+band.sources.join(' · ')});
 }
 for(const doc of plan.prefilled?.relatedDocuments??[])evidence.push({id:'related-'+evidence.length,label:'Arquivo relacionado: '+doc.name,value:doc.message,source:doc.source});
 for(const [i,tariff] of (plan.prefilled?.tariffs??[]).entries()){
  if(typeof tariff.source!=='string'||!tariff.source||typeof tariff.rateMwh!=='string'||!/^\d{1,18}(\.\d{1,12})?$/.test(tariff.rateMwh))continue;
  evidence.push({id:'prefilled-tariff-'+i,label:String(tariff.component)+' · '+String(tariff.band)+' · proposta OCR R$/MWh',value:tariff.rateMwh,source:tariff.source+' · '+String(tariff.reason??'Conferir a fonte')+' · Proposta de preenchimento; não comprova parâmetro aprovado nem valor pago.'});
 }
 if(plan.prefilled?.library){
  const library=plan.prefilled.library;
  for(const item of library.items??[])evidence.push({id:'library-'+evidence.length,label:'Referência tarifária cadastrada · '+item.label+' · '+item.band,value:item.value+' '+item.measure,source:'Biblioteca tarifária · versão '+library.version+' · vigência '+library.start+' a '+library.end+' · '+library.source+'. Referência para conferência; não comprova valor pago nem aprovação do parâmetro.'});
 }
 return evidence;
}

// Project only explicit calculation results, never entire contract rows, private
// attachments or totals for a different unit. Called with the scoped diagnosis.
export function financialAiEvidence(context:any):AiEvidence[]{
 if(!context)return [];
 const result:AiEvidence[]=[];
 const decimal=(value:unknown)=>typeof value==='string'&&/^-?\d{1,18}(\.\d{1,12})?$/.test(value);
 const text=(value:unknown)=>typeof value==='string'?value.slice(0,200):'Não identificado';
 const supplier=context.supplier;
 if(supplier&&['READY','PENDING','BLOCKED'].includes(supplier.status)){
  const source=`Motor ${text(supplier.formulaVersion)} · contrato ${text(supplier.contract?.number)} · vigência ${text(supplier.contract?.start)} a ${text(supplier.contract?.end)} · estado ${supplier.status}. Não comprova aprovação financeira.`;
  for(const [key,label] of [['consumedMwh','Consumo contratual MWh'],['billedMwh','Volume faturável MWh'],['pricePerMwh','Preço contratual por MWh'],['totalAmount','Custo contratual calculado'],['invoiceAmount','Valor da fatura do fornecedor'],['invoiceDifference','Diferença calculada entre contrato e fatura']] as const){
   if(decimal(supplier[key])&&(supplier.status!=='BLOCKED'||key==='pricePerMwh'&&supplier.contract&&supplier.rule&&supplier.priceSource))result.push({id:'supplier-'+key,label,value:supplier[key],source:source+' · '+text(supplier.priceSource)+' · tributos: '+text(supplier.taxTreatment)});
  }
 }
 const fees=context.managementFees;
 if(fees&&['FIXED_AVAILABLE','VARIABLE_PENDING'].includes(fees.status)){
  const source=`Motor ${text(fees.formulaVersion)} · contrato ${text(fees.contract?.number)} · estado ${fees.status}. Consulta preliminar, sem cobrança ou publicação.`;
  if(decimal(fees.fixedUnit))result.push({id:'management-fixed',label:'Honorário fixo por unidade',value:fees.fixedUnit,source});
  if(fees.status==='FIXED_AVAILABLE'&&decimal(fees.totalFee))result.push({id:'management-total',label:'Honorário total fixo calculado',value:fees.totalFee,source});
  if(fees.status==='VARIABLE_PENDING')result.push({id:'management-pending',label:'Honorário variável pendente',value:'Parcela variável e total aguardam consolidação de todas as unidades do cliente.',source});
 }
 for(const scenario of context.distributor?.scenarios??[]){
  if(scenario.status==='AVAILABLE'&&['ACL','ACR'].includes(scenario.scenario)&&decimal(scenario.subtotal))result.push({id:'distributor-'+scenario.scenario,label:'Subtotal da distribuidora '+scenario.scenario,value:scenario.subtotal,source:`Motor ${text(context.distributor.formulaVersion)}. Apenas subtotal da distribuidora; não é custo total do cenário nem economia publicada.`});
 }
 return result;
}
