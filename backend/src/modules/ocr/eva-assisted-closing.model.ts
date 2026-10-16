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
 const observations:string[]=[],recommendations:string[]=[],units:any[]=[],missing:string[]=[];
 const add=(s:string)=>{if(!observations.includes(s))observations.push(s);};
 let estimated=false;
 for(const e of entries){
  const p=e.plan,c=e.context,ownMissing:string[]=[],o=p?.operational;
  const row:any={id:e.unitId,name:e.name,documentId:c?.document?.id??null,sourceHash:c?.document?.file_hash??null,fields:p?.fields??[],sources:{library:p?.library??null,reference:p?.reference??null},acr:null,aclBeforeFees:null,fixedFee:null,variableFee:null,totalFees:null,aclAfterFees:null,savings:null,comparison:null,prepared:{invoice:o?.invoice??null,supplier:o?.supplier??null,acr:o?.acr??null,fixedFee:o?.fixedFee??null},missing:ownMissing};units.push(row);
  if(e.unavailable||!p||o?.state==='UNAVAILABLE'){ownMissing.push(e.unavailable??'Vínculo ou fonte da fatura indisponível.');continue;}
  try{
   const acr=e.comparative?(e.comparative.amount===null?null:money(e.comparative.amount)):acrTotal(e,ownMissing);
   if(e.comparative){estimated=true;row.methodology=e.comparative;ownMissing.push(...e.comparative.missing);for(const n of e.comparative.observations)add(n);}if(acr!==null)row.acr=fmt(acr);
   const invoice=money(o.invoice.amount),supplier=money(o.supplier.amount);if(invoice<0n||supplier<0n)throw Error();
   // The reference is an explicitly estimated energy price, never an assertion of a current contract.
   if(p.referenceUsed||Object.keys(p.manualOverrides??{}).length){estimated=true;add('Preço/condição de referência ou valor comercial do operador usado na competência atual; sem prorrogar contrato.');}
   const supplierTax=field(p,'supplier:tax')?.value;
   if(!['GROSS','INCLUDED','EXEMPT','NOT_APPLICABLE'].includes(supplierTax)&&!e.comparative){ownMissing.push('Fornecedor: o preço de energia está proposto, mas a composição final de tributos/encargos não está demonstrada.');}
   if(e.comparative&&!['GROSS','INCLUDED','EXEMPT','NOT_APPLICABLE'].includes(supplierTax)){estimated=true;add('Fornecedor: preço usado como referência comparativa, com composição fiscal não demonstrada. Não representa isenção ou tributos incluídos confirmados.');}
   let extraAcl=0n,extraAcr=0n;
   const costs=field(p,'costs:monthly')?.value;
   if(!costs||!Array.isArray(costs.items)||typeof costs.noCosts!=='boolean'||costs.noCosts&&costs.items.length)ownMissing.push('Custos adicionais: revisão da competência não demonstrada.');
   else for(const item of costs.items){
    if((item.scenario==='ACL'||e.comparative)&&item.source?.includes(c.document.id))continue;
    if(['SUPPLIER_INVOICE','SUPPLIER_EXTRA_ENERGY'].includes(item.category)){ownMissing.push('Conciliar compra/nota do fornecedor para evitar dupla contagem.');continue;}
    if(!item.source?.trim()||!['COST','CREDIT'].includes(item.effect)||!['INCLUDED','NOT_APPLICABLE'].includes(item.taxTreatment)||!['ACL','ACR'].includes(item.scenario)){ownMissing.push('Custo adicional sem fonte ou tratamento final demonstrado.');continue;}
    const amount=money(item.amount);if(amount<0n)throw Error();if(item.scenario==='ACL')extraAcl+=item.effect==='CREDIT'?-amount:amount;else extraAcr+=item.effect==='CREDIT'?-amount:amount;
   }
   row.aclBeforeFees=fmt(invoice+supplier+extraAcl);if(acr!==null)row.acr=fmt(acr+extraAcr);
   row.fixedFee=fmt(money(field(p,'fee:fixed')?.value));if(money(row.fixedFee)<0n)throw Error();
  }catch{ownMissing.push('Uma parcela monetária essencial está ausente ou inconsistente.');}
  if((c?.rates??[]).some((r:any)=>r.state==='CONFLICT')||c?.input?.status==='DRAFT'&&c?.monthlyChanges?.length)ownMissing.push('Há divergência material entre a fatura e o rascunho existente; confira a fonte antes da decisão.');
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
 if(!missing.length){try{
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
 const completeness=missing.length?'INCOMPLETE':estimated?'ESTIMATED':'COMPLETE';
 return {formatVersion:'eva-assisted-closing-1.0',methodology:entries.some(e=>e.comparative)?'SAME_INVOICE_QUANTITIES_AND_CHARGES_V1':'SOURCE_BILLING_V1',organizationId:org,customerId:customer,month,unitIds:entries.map(e=>e.unitId).sort(),completeness,approvalEligible:!missing.length,financial,units,missing:[...new Set(missing)],observations:[...new Set(observations)],recommendations:[...new Set(recommendations)],justification:missing.length?'A EVA preencheu as fontes disponíveis. O fechamento permanece incompleto pelas evidências relacionadas no resumo; nenhum total parcial foi convertido em resultado final.':estimated?'Fechamento preparado com referências identificadas e memória preservada. Confira as condições e diferenças antes da decisão.':'Fechamento preparado com fontes da competência e cálculos preservados para decisão.',publicationAllowed:false,automaticApproval:false};
}
