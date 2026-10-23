import {documentedSettlementEnabled} from './documented-tariff-period';
import {contractClosingDraftEnabled} from './contract-closing-draft';
import {indexMemoryHash} from '../contracts/services/contract-index-memory.model';
import {sourcePreparationEnabled} from './source-preparation-v3';
import type {InvoiceComparison} from './eva-tariff-workbench.model';
import {feeMoney,allocateFee} from '../contracts/services/management-fee';
import {tariffProduct} from '../contracts/services/tariff-preview';
export type ClosingEntry={unitId:string;name:string;plan?:any;context?:any;comparative?:InvoiceComparison;unavailable?:string};
const money=(value:unknown)=>{const v=typeof value==='number'&&Number.isFinite(value)?String(value):value;if(typeof v!=='string'||!/^-?(0|[1-9][0-9]{0,11})(\.\d{1,2})?$/.test(v))throw Error('Valor monetário sem base');const [w,f='']=v.replace('-','').split('.');return (BigInt(w)*100n+BigInt(f.padEnd(2,'0')))*(v.startsWith('-')?-1n:1n);};
const scale=(v:unknown,p=6)=>{if(typeof v!=='string'||!new RegExp('^-?(0|[1-9][0-9]{0,11})(\\.\\d{1,'+p+'})?$').test(v))throw Error('Decimal sem base');const [w,f='']=v.replace('-','').split('.');return (BigInt(w)*10n**BigInt(p)+BigInt(f.padEnd(p,'0')))*(v.startsWith('-')?-1n:1n);};
const fixed=(v:bigint,p:number)=>{const s=(v<0n?-v:v).toString().padStart(p+1,'0');return (v<0n?'-':'')+s.slice(0,-p)+'.'+s.slice(-p);};
const rounded=(n:bigint,d:bigint)=>{if(d<=0n)throw Error();return (n<0n?-1n:1n)*(((n<0n?-n:n)+d/2n)/d);};
const fmt=feeMoney;
const field=(p:any,key:string)=>p?.fields?.find((f:any)=>f.key===key&&f.state==='FILLED');
function acrTotal(entry:ClosingEntry,missing:string[]){
 let blocked=false;const missingTaxes:string[]=[];
 const p=entry.plan,o=p?.operational,rates=(p?.fields??[]).filter((f:any)=>f.key.startsWith('ACR:')&&!f.key.includes(':tax:')&&f.key!=='ACR:library');
 if(!p?.library||!rates.length||rates.some((f:any)=>f.state!=='FILLED'||!o?.acr?.lines?.some((l:any)=>l.key===f.key))){missing.push('ACR: existem rubricas sem tarifa da biblioteca ou quantidade faturável demonstrada.');blocked=true;}
 if((p.fields??[]).some((f:any)=>f.key.startsWith('reactive')&&f.state==='FILLED'&&typeof f.value==='string'&&scale(f.value)>0n)&&!rates.some((f:any)=>f.key.startsWith('ACR:REACTIVE:'))){missing.push('ACR: o reativo da fatura não possui rubrica correspondente na biblioteca.');blocked=true;}
 const lines=o?.acr?.lines??[];let total=lines.reduce((sum:bigint,l:any)=>sum+money(l.amount),0n);const params=entry.context?.captured?.parameters??[];
 for(const code of ['ICMS','PIS','COFINS']){
  const value=field(p,'ACR:tax:'+code)?.value;
  if(!value||!['EXEMPT','NOT_APPLICABLE','INSIDE','OUTSIDE'].includes(value.treatment)){missingTaxes.push(code);blocked=true;continue;}
  if(['EXEMPT','NOT_APPLICABLE'].includes(value.treatment))continue;
  try{
   const rate=scale(value.rate);if(rate<0n||rate>=100000000n||value.basis?.version!==1||value.basis?.interaction!=='INDEPENDENT'||!Array.isArray(value.basis.items)||!value.basis.items.length||new Set(value.basis.items.map((i:any)=>i.parameterId)).size!==value.basis.items.length)throw Error();
   let base=0n;const included=new Set<string>();
   for(const item of value.basis.items){
    const refs=params.filter((x:any)=>x.id===item.parameterId&&x.scenario==='ACR'&&x.kind==='TARIFF'&&x.revision===item.revision&&x.treatment==='NET'&&['DRAFT','APPROVED'].includes(x.status));if(refs.length!==1||!['INCLUDE','EXCLUDE'].includes(item.operation))throw Error();
    const ref=refs[0],key='ACR:'+ref.component_code+':'+ref.time_band,ls=lines.filter((l:any)=>l.key===key&&l.rate===ref.amount_text&&l.measure===ref.measure);if(ls.length!==1)throw Error();included.add(key);
    if(item.operation==='INCLUDE')base+=scale(tariffProduct(ls[0].quantity,ls[0].rate,ls[0].measure==='BRL_MWH').exact,18);
   }
   if(included.size!==lines.length)throw Error();
   total+=rounded(base*rate*100n,10n**18n*(value.treatment==='INSIDE'?100000000n-rate:100000000n));
  }catch{missing.push('ACR: base estruturada de '+code+' incompleta ou interação tributária ainda não demonstrada.');blocked=true;}
 }
 if(missingTaxes.length)missing.push('ACR: base e tratamento de '+missingTaxes.join(', ')+' não demonstrados; não foi presumida isenção.');
 return blocked?null:total;
}
export function historicalDifference(label:string,current:unknown,previous:unknown,basis:string){
 try{const a=scale(current),b=scale(previous),d=a-b;return {label,basis,current:String(current),previous:String(previous),difference:fixed(d,6),percent:b===0n?null:fixed(rounded(d*10000n,b<0n?-b:b),2),comparable:true};}catch{return {label,basis,current:current??null,previous:previous??null,difference:null,percent:null,comparable:false};}
}
/** Private financial candidate, never a published settlement or a human attestation. */
export function assistedClosingReport(org:string,customer:string,month:string,entries:ClosingEntry[]){
 const observations:string[]=[],recommendations:string[]=[],units:any[]=[],missing:string[]=[],pendingActions:any[]=[];
 const estimateReviews=new Set<string>();
 const add=(s:string)=>{if(!observations.includes(s))observations.push(s);};
 let estimated=false;
 for(const e of entries){
  const p=e.plan,c=e.context,ownMissing:string[]=[],o=p?.operational;
  const draft=contractClosingDraftEnabled()&&p?.contractDraft&&c?.contractDraft&&indexMemoryHash(p.contractDraft)===indexMemoryHash(c.contractDraft)?p.contractDraft:null;
  if(draft)pendingActions.push(...draft.requirements.map((r:any)=>({...r,unitId:e.unitId})));
  if(contractClosingDraftEnabled()&&e.comparative?.missing.length)pendingActions.push({code:'ACR_COMPARISON',unitId:e.unitId,section:'library',message:[...new Set(e.comparative.missing)].join(' ')});
  const row:any={id:e.unitId,name:e.name,documentId:c?.document?.id??null,sourceHash:c?.document?.file_hash??null,fields:p?.fields??[],sources:{...(p?.sourcePreparation?{sourcePreparation:p.sourcePreparation}:{}),...(draft?{contractDraft:draft}:{}),library:p?.library??null,reference:p?.reference??null},acr:null,aclBeforeFees:null,fixedFee:null,feePercentage:field(p,'fee:percentage')?.value??null,variableFee:null,totalFees:null,aclAfterFees:null,savings:null,comparison:null,prepared:{ccee:p?.cceeEstimate??null,invoice:o?.invoice??null,supplier:o?.supplier??null,acr:o?.acr??null,fixedFee:o?.fixedFee??null},missing:ownMissing};units.push(row);
  if(p?.cceeEstimate?.state==='ESTIMATED'){estimated=true;const message='CCEE: estimativa histórica preenchida. Revise a memória e registre os custos da competência antes de aprovar.';ownMissing.push(message);estimateReviews.add(e.name+': '+message);pendingActions.push({code:'CCEE_ESTIMATE_REVIEW',unitId:e.unitId,section:'costs',message});row.sources.cceeEstimate=p.cceeEstimate;}
  if(p?.supplierInvoiceProposal){row.sources.supplierInvoiceProposal=p.supplierInvoiceProposal;add('Fornecedor: NF integral proposta, volume comprado preservado separadamente da medição. Conferir composição tributária.');}
  if(sourcePreparationEnabled()&&!draft){
   const supplier=c?.diagnosis?.contractSupplierCost;
   if(supplier?.contract&&supplier.formulaVersion!=='spot-supplier-1.0'&&supplier.maxMwh!=null&&c?.measurements?.consumptionTotal!=null)try{
    if(scale(c.measurements.consumptionTotal,12)/1000n>scale(supplier.maxMwh,12)&&supplier.extraAmount==null)ownMissing.push('Fornecedor: o consumo proposto excede o limite contratual. O custo e a fonte da compra extra precisam ser demonstrados; a parcela regular não representa o custo completo.');
   }catch{ownMissing.push('Fornecedor: não foi possível conferir o limite de volume contra o consumo proposto.');}
  }
  if(sourcePreparationEnabled()&&!draft)for(const requirement of c?.diagnosis?.contractSupplierCost?.requirements??[])if(['EXTRA_PURCHASE','EXTRA_TAX','UNEXPECTED_EXTRA','EXTRA_CREDIT','INVOICE_DIFFERENCE','INVOICE_TAX','CONDITIONS','PARTIAL_RULE'].includes(requirement.code))ownMissing.push('Fornecedor: '+requirement.message);
  if(sourcePreparationEnabled()&&!draft)for(const doc of p?.sourcePreparation?.documents??[])for(const conflict of doc.conflicts??[])ownMissing.push('Contrato/anexo: '+conflict);
  if(draft){for(const r of draft.requirements)ownMissing.push(r.message);if(draft.state!=='COMPLETE'&&!draft.requirements.length)ownMissing.push('Proposta contratual sem composição integral comprovada.');for(const conflict of draft.differences)add('Diferença contratual para conferência: '+conflict);}
  if(sourcePreparationEnabled()&&o?.fixedFee?.source)try{const known=money(o.fixedFee.amount);if(known>=0n)row.fixedFee=fmt(known);}catch{/* independent known card remains unavailable */}
  if(e.unavailable||!p||o?.state==='UNAVAILABLE'){ownMissing.push(e.unavailable??'Vínculo ou fonte da fatura indisponível.');continue;}
  try{
   const acr=e.comparative?(e.comparative.amount===null?null:money(e.comparative.amount)):acrTotal(e,ownMissing);
   if(e.comparative){estimated=true;row.methodology=e.comparative;ownMissing.push(...e.comparative.missing);for(const n of e.comparative.observations)add(n);}if(acr!==null)row.acr=fmt(acr);
   const supplierProof=e.comparative?.supplierIcms;
   const invoice=money(o.invoice.amount),supplier=money(supplierProof?.amount??o.supplier.amount);if(invoice<0n||supplier<0n)throw Error();
   if(supplierProof?.additional){
    if(money(supplierProof.base)!==money(o.supplier.amount)||money(supplierProof.base)+money(supplierProof.icmsAmount)!==supplier)throw Error();
    row.prepared.supplier={...o.supplier,amount:supplierProof.amount,netAmount:supplierProof.base,icmsAmount:supplierProof.icmsAmount,taxMemory:supplierProof};
    row.sources.supplierIcms=supplierProof;
    row.fields=row.fields.map((f:any)=>f.key==='supplier:tax'?{...f,state:'FILLED',value:{...supplierProof,policy:'COMPONENT_TAXES_V3'},source:supplierProof.source,observation:supplierProof.note}:f);
    add('Fornecedor: ICMS por dentro destacado na memória, incluído uma única vez no custo ACL.');
   }
   // The reference is an explicitly estimated energy price, never an assertion of a current contract.
   if(p.referenceUsed||Object.keys(p.manualOverrides??{}).length){estimated=true;add('Preço/condição de referência ou valor comercial do operador usado na competência atual; sem prorrogar contrato.');}
   const supplierTax=field(p,'supplier:tax')?.value;
   const documentedTax=documentedSettlementEnabled()&&draft?.format==='documented-supplier-settlement-1'&&draft.state==='COMPLETE'&&supplierTax==='COMPONENTS_CONFIRMED';
   if(!documentedTax&&!['GROSS','INCLUDED','EXEMPT','NOT_APPLICABLE'].includes(supplierTax)&&!e.comparative){ownMissing.push('Fornecedor: o preço de energia está proposto, mas a composição final de tributos/encargos não está demonstrada.');}
   if(e.comparative&&!supplierProof&&!documentedTax&&!['GROSS','INCLUDED','EXEMPT','NOT_APPLICABLE'].includes(supplierTax)){estimated=true;add('Fornecedor: preço usado como referência comparativa, com composição fiscal não demonstrada. Não representa isenção ou tributos incluídos confirmados.');}
   let extraAcl=0n,extraAcr=0n,supplierExtras=0n;
   const costs=field(p,'costs:monthly')?.value,rawCosts=p.fields?.find((f:any)=>f.key==='costs:monthly'),proof=e.comparative?.invoiceProof;
   const invoiceOnly=proof!==undefined&&['SAME_INVOICE_AMOUNTS_V2','COMPONENT_TAXES_V3'].includes(e.comparative?.method??'')&&e.comparative!.amount!==null&&!e.comparative!.missing.length&&proof.documentId===c?.document?.id&&/^[a-f0-9]{64}$/.test(proof.sourceHash)&&proof.sourceHash===c?.document?.file_hash&&money(proof.amount)===invoice&&c.cost==null&&(!rawCosts||rawCosts.state==='PENDING'&&rawCosts.value===null&&!rawCosts.source);
   if(invoiceOnly){
    row.costCoverage={scope:'RECONCILED_INVOICE_ONLY',documentId:proof!.documentId,sourceHash:proof!.sourceHash,amount:proof!.amount};
    const observation='Despesas e créditos conciliados da fatura incluídos uma única vez. Despesas externas não informadas ficam fora desta estimativa; não foi registrada declaração de ausência de custos.';
    add(e.name+': '+observation);recommendations.push('Confira despesas externas ao documento antes de aprovar a estimativa.');
    row.fields=row.fields.map((f:any)=>f.key==='costs:monthly'?{...f,state:'FILLED',value:row.costCoverage,source:'Fatura '+proof!.documentId+' · SHA-256 '+proof!.sourceHash,observation}:f);
   }
   else if(!costs||!Array.isArray(costs.items)||typeof costs.noCosts!=='boolean'||costs.noCosts&&costs.items.length)ownMissing.push('Custos adicionais: revisão da competência não demonstrada.');
   else for(const item of costs.items){
    if(draft?.state==='COMPLETE'&&draft.consumedCostSources.some((proof:any)=>proof.id===item.id&&proof.costId===c.cost?.id&&proof.hash===indexMemoryHash(item)))continue;
    if((item.scenario==='ACL'||e.comparative)&&item.source?.includes(c.document.id))continue;
    const confirmedInvoiceExtra=draft?.format==='supplier-invoice-evidence-1'&&draft.state==='COMPLETE'&&item.category==='SUPPLIER_EXTRA_ENERGY'&&draft.confirmedExtraCostSources.some((proof:any)=>proof.id===item.id&&proof.costId===c.cost?.id&&proof.hash===indexMemoryHash(item));
    if(['SUPPLIER_INVOICE','SUPPLIER_EXTRA_ENERGY'].includes(item.category)&&!confirmedInvoiceExtra){ownMissing.push('Conciliar compra/nota do fornecedor para evitar dupla contagem.');continue;}
    const confirmedFinal=documentedTax&&(draft.confirmedFinalCostSources??[]).some((proof:any)=>proof.id===item.id&&proof.costId===c.cost?.id&&proof.hash===indexMemoryHash(item));
    if(!item.source?.trim()||!['COST','CREDIT'].includes(item.effect)||!confirmedFinal&&!['INCLUDED','NOT_APPLICABLE'].includes(item.taxTreatment)||!['ACL','ACR'].includes(item.scenario)){ownMissing.push('Custo adicional sem fonte ou tratamento final demonstrado.');continue;}
    const amount=money(item.amount);if(amount<0n)throw Error();if(confirmedInvoiceExtra)supplierExtras+=amount;if(item.scenario==='ACL')extraAcl+=item.effect==='CREDIT'?-amount:amount;else extraAcr+=item.effect==='CREDIT'?-amount:amount;
   }
   if(p?.cceeEstimate?.state==='ESTIMATED'){if((costs?.items??[]).some((i:any)=>i.category==='CCEE'&&i.scenario==='ACL'))ownMissing.push('CCEE: registro atual e estimativa concorrentes; reconferir fontes.');else extraAcl+=money(p.cceeEstimate.total);}
   if(supplierExtras>0n)row.prepared.supplier={...row.prepared.supplier,regularAmount:fmt(supplier),extraAmount:fmt(supplierExtras),amount:fmt(supplier+supplierExtras),extraSources:draft.confirmedExtraCostSources};
   row.aclBeforeFees=fmt(invoice+supplier+extraAcl);if(acr!==null)row.acr=fmt(acr+extraAcr);
   row.fixedFee=fmt(money(field(p,'fee:fixed')?.value));if(money(row.fixedFee)<0n)throw Error();
   // The report displays the evidence used by this method, without editing legacy parameters.
   if(e.comparative&&['SAME_INVOICE_AMOUNTS_V2','COMPONENT_TAXES_V3'].includes(e.comparative.method)&&acr!==null&&!e.comparative.missing.length){
    const comparison=e.comparative,lib=comparison.library;
    row.sources={...row.sources,library:lib};
    row.prepared={...row.prepared,acr:{identifiedAmount:fmt(comparison.lines.reduce((total:bigint,l:any)=>total+money(l.amount),0n)),lines:comparison.lines.map(l=>({...l,key:'ACR:'+l.component+':'+l.band,rate:l.value})),source:'Biblioteca '+lib.id+' v'+lib.version,method:comparison.method}};
    row.fields=row.fields.filter((f:any)=>!f.key.startsWith('ACR:')&&!/^(ACL|ACR):tax:/.test(f.key));
    row.fields.push({key:'ACR:library',label:'Biblioteca ACR selecionada',state:'FILLED',value:lib.id,unit:'',scenario:'ACR',source:'Biblioteca '+lib.id+' v'+lib.version+' · '+lib.source,observation:'Tarifas líquidas elegíveis para a metodologia comparativa.'});
    for(const l of comparison.lines)row.fields.push({key:'ACR:'+l.component+':'+l.band,label:l.label,state:'FILLED',value:l.value,unit:l.measure,scenario:'ACR',source:l.source,observation:'Quantidade aplicada: '+l.quantity+' · '+l.quantitySource});
    for(const scenario of ['ACL','ACR'])for(const t of scenario==='ACR'&&comparison.acrTaxes?comparison.acrTaxes:comparison.taxes??[])row.fields.push({key:scenario+':tax:'+({icmsAmount:'ICMS',pisAmount:'PIS',cofinsAmount:'COFINS'} as any)[t.code],label:t.code,state:'FILLED',value:{amount:t.amount,printedRate:t.printedRate??null,method:t.method},unit:'BRL',scenario,source:t.summarySource,observation:t.note});
   }
  }catch{const missingAmounts=[['Distribuidora: total conciliado da fatura',o?.invoice?.amount],['Fornecedor: energia regular, reajuste e eventual compra excedente',o?.supplier?.amount]].filter(([,v])=>{try{return money(v)<0n;}catch{return true;}}).map(([label])=>label+' ainda sem valor e fonte suficientes.');ownMissing.push(...(missingAmounts.length?missingAmounts:['Uma parcela monetária essencial está ausente ou inconsistente. Confira custos e honorários nas fontes desta competência.']));}
  const legacyTariffConflict=(c?.rates??[]).some((r:any)=>r.state==='CONFLICT');
  let reconciledInvoiceComparison=false;
  try{const comparison=e.comparative,proof=comparison?.invoiceProof;reconciledInvoiceComparison=comparison?.method==='COMPONENT_TAXES_V3'&&comparison.amount!==null&&money(comparison.amount)>=0n&&!comparison.missing.length&&c?.originalIdentity?.state==='MATCH'&&c.originalIdentity.fileHash===c.document?.file_hash&&proof?.documentId===c.document?.id&&/^[a-f0-9]{64}$/.test(proof?.sourceHash??'')&&proof?.sourceHash===c.document?.file_hash&&money(proof!.amount)===money(o?.invoice?.amount);}catch{/* incomplete or foreign proof remains blocking */}
  if(legacyTariffConflict){if(reconciledInvoiceComparison)add('Parâmetros legados ACL exigem revisão cadastral. Neste fechamento, o total e os tributos ACL vêm da fatura original reconciliada; parâmetros antigos não foram usados para recalcular a cobrança. Cadastros e fontes anteriores preservados.');else ownMissing.push('Há divergência material entre a fatura e o rascunho existente; confira a fonte antes da decisão.');}
  if(c?.input?.status==='DRAFT'&&c?.monthlyChanges?.length)ownMissing.push('Há divergência material entre a fatura e o rascunho existente; confira a fonte antes da decisão.');
  const prior=c?.reference;
  if(prior?.comparison){
   const old=prior.comparison;
   row.comparison={month:prior.month,version:prior.version,hash:prior.hash,id:prior.id,consecutive:(Number(month.slice(0,4))*12+Number(month.slice(5)))-(Number(prior.month.slice(0,4))*12+Number(prior.month.slice(5)))===1,metrics:[
    historicalDifference('Consumo total',field(p,'consumptionTotal')?.value,old.measurements?.consumptionTotal,'kWh'),
    historicalDifference('Consumo ponta',field(p,'consumptionPeak')?.value,old.measurements?.consumptionPeak,'kWh'),
    historicalDifference('Consumo fora ponta',field(p,'consumptionOffPeak')?.value,old.measurements?.consumptionOffPeak,'kWh'),
    historicalDifference('Demanda medida',field(p,'demandSingle')?.value,old.measurements?.demandSingle,'kW'),
    historicalDifference('Preço do fornecedor',field(p,'supplier:price')?.value,old.supplierPrice,'BRL/MWh'),
    historicalDifference('Honorário fixo',row.fixedFee,old.unit?.fixedFee,'BRL'),
    historicalDifference('Distribuidora',o?.invoice?.amount,typeof old.distributor==='string'?old.distributor:old.distributor?.amount??old.distributor?.total,'BRL · somente totais conciliados'),
    historicalDifference('Custo ACR',row.acr,old.unit?.acr,'BRL · totais comparáveis somente com cobertura integral atual'),
    historicalDifference('Custo ACL antes dos honorários',ownMissing.length?null:row.aclBeforeFees,old.unit?.aclBeforeFees,'BRL')
   ],tariffChanges:(p.fields??[]).filter((f:any)=>f.key.startsWith('ACR:')&&!f.key.includes(':tax:')).map((f:any)=>{const [,component,band]=f.key.split(':'),oldRate=(old.tariffs??[]).filter((t:any)=>t.component===component&&t.band===band&&t.measure===f.unit);return {label:f.label,current:f.value,previous:oldRate.length===1?oldRate[0].rate:null,measure:f.unit,comparable:oldRate.length===1&&oldRate[0].treatment==='NET'};})};
   for(const d of row.comparison.metrics.filter((d:any)=>d.comparable&&scale(d.difference)!==0n))add(e.name+': '+d.label+' variou de '+d.previous+' para '+d.current+' '+d.basis+'. Diferença observada; nenhuma causa não comprovada foi atribuída.');
   if(!row.comparison.consecutive)add('A referência de '+e.name+' é '+prior.month+'; não é o mês imediatamente anterior.');
  }else add('Não há fechamento anterior íntegro e elegível para comparar '+e.name+'.');
  for(const note of p.observations??[])add(note);
  if(p.referenceUsed)recommendations.push('Atualize o cadastro e mantenha o contrato/preço vigente para as próximas competências.');
 }
 for(const u of units)for(const m of u.missing)if(!missing.includes(u.name+': '+m))missing.push(u.name+': '+m);
 const financial:any={status:'INCOMPLETE',acr:null,aclBeforeFees:null,fixedFee:null,variableFee:null,totalFees:null,aclAfterFees:null,savings:null,savingsPercent:null};
 if(!entries.length||new Set(entries.map(e=>e.unitId)).size!==entries.length)missing.push('O conjunto de unidades está ausente ou duplicado.');
 const estimateReviewOnly=missing.length>0&&missing.every(m=>estimateReviews.has(m));
 if(!missing.length||estimateReviewOnly){try{
  const hybrids=entries.map(e=>(e.plan.fields??[]).some((f:any)=>f.key==='fee:percentage'));
  if(new Set(hybrids).size!==1)throw Error('Os modelos de honorários das unidades não são compatíveis.');
  const acr:bigint=units.reduce((n:bigint,u:any)=>n+money(u.acr),0n),acl:bigint=units.reduce((n:bigint,u:any)=>n+money(u.aclBeforeFees),0n),fixedFee:bigint=units.reduce((n:bigint,u:any)=>n+money(u.fixedFee),0n),base=acr-acl;
  let variable=0n,shares=units.map(u=>({consumerUnitId:u.id,amount:'0.00'}));
  if(hybrids[0]){
   const percentages=entries.map(e=>field(e.plan,'fee:percentage')?.value);if(new Set(percentages).size!==1)throw Error('Honorário percentual divergente entre unidades.');const percent=scale(percentages[0]);if(percent<0n||percent>100000000n)throw Error('Honorário percentual inválido.');
   const allocations=entries.map(e=>field(e.plan,'fee:allocation')?.value);if(!allocations.every(a=>JSON.stringify(a)===JSON.stringify(allocations[0])))throw Error('Rateio mensal divergente entre unidades.');const a=allocations[0];if(!Array.isArray(a)||a.length!==units.length||a.some(x=>!units.some(u=>u.id===x.consumerUnitId)))throw Error('Rateio não cobre todas as unidades do cliente.');
   variable=base>0n?rounded(base*percent,100000000n):0n;shares=allocateFee(fmt(variable),a);
  }
  const fees=fixedFee+variable,after=acl+fees,savings=acr-after;
  Object.assign(financial,{status:'AVAILABLE',acr:fmt(acr),aclBeforeFees:fmt(acl),fixedFee:fmt(fixedFee),variableFee:fmt(variable),totalFees:fmt(fees),aclAfterFees:fmt(after),savings:fmt(savings),savingsPercent:acr>0n?fixed(rounded(savings*10000n,acr),2):null});
  for(const u of units){const share=shares.find(x=>x.consumerUnitId===u.id)!;u.variableFee=share.amount;u.totalFees=fmt(money(u.fixedFee)+money(share.amount));u.aclAfterFees=fmt(money(u.aclBeforeFees)+money(u.totalFees));u.savings=fmt(money(u.acr)-money(u.aclAfterFees));}
 }catch(e){for(const key of Object.keys(financial))financial[key]=key==='status'?'INCOMPLETE':null;missing.push(e instanceof Error?e.message:'Consolidado indisponível.');}}
 for(let i=0;i<units.length;i++){const u=units[i],old=entries[i]?.context?.reference?.comparison?.unit;if(u.comparison&&old){for(const [label,key,previous] of [['Honorário variável','variableFee',old.variableFee],['Honorários totais','totalFees',old.totalFees],['ACL com honorários','aclAfterFees',old.aclAfterFees],['Economia','savings',old.savingsAfterFees]])u.comparison.metrics.push(historicalDifference(label,missing.length?null:u[key],previous,'BRL'));}}
 let proposalFinancial:any=null;
 if(estimateReviewOnly&&financial.status==='AVAILABLE'){
  proposalFinancial={...financial,status:'ESTIMATED_REVIEW_REQUIRED',reviewRequired:true};
  for(const key of Object.keys(financial))financial[key]=key==='status'?'INCOMPLETE':null;
 }
 const completeness=missing.length?'INCOMPLETE':estimated?'ESTIMATED':'COMPLETE';
 return {...(proposalFinancial?{proposalFinancial,preparation:{state:'COMPLETE_REVIEW_REQUIRED',percent:100}}:{}),formatVersion:'eva-assisted-closing-1.0',methodology:entries.find(e=>e.comparative)?.comparative?.method??'SOURCE_BILLING_V1',organizationId:org,customerId:customer,month,unitIds:entries.map(e=>e.unitId).sort(),completeness,approvalEligible:!missing.length,financial,units,missing:[...new Set(missing)],pendingActions,observations:[...new Set(observations)],recommendations:[...new Set(recommendations)],justification:proposalFinancial?'Preenchimento da proposta concluído pela EVA. Valores CCEE estimados e totais provisórios aguardam revisão do backoffice antes da aprovação.':missing.length?'A EVA preencheu as fontes disponíveis. O fechamento permanece incompleto pelas evidências relacionadas no resumo; nenhum total parcial foi convertido em resultado final.':estimated?'Fechamento preparado com referências identificadas e memória preservada. Confira as condições e diferenças antes da decisão.':'Fechamento preparado com fontes da competência e cálculos preservados para decisão.',publicationAllowed:false,automaticApproval:false};
}
