import {tariffProduct} from '../contracts/services/tariff-preview';
import type {FillField} from './calculation-autofill.model';

export type OperationalProposal={formatVersion:'eva-operational-proposal-1.0';state:'PROPOSED'|'PARTIAL'|'UNAVAILABLE';invoice:{amount:string|null;source:string;lines:{key:string;label:string;amount:string|null;source:string}[]};acr:{identifiedAmount:string|null;lines:{key:string;label:string;quantity:string;measure:string;rate:string;amount:string;source:string}[]};supplier:{amount:string|null;source:string};fixedFee:{amount:string|null;source:string};observations:string[];financialApproval:false;canPublish:false};
const decimal=(v:unknown):v is string=>typeof v==='string'&&/^(0|[1-9][0-9]{0,11})(\.\d{1,6})?$/.test(v);
const money=(v:unknown):v is string=>typeof v==='string'&&/^-?(0|[1-9][0-9]{0,11})(\.\d{1,2})?$/.test(v);
const cents=(v:string)=>{const negative=v.startsWith('-'),[w,f='']=v.replace('-','').split('.');return (BigInt(w)*100n+BigInt(f.padEnd(2,'0')))*(negative?-1n:1n);};
const format=(v:bigint)=>{const s=(v<0n?-v:v).toString().padStart(3,'0');return (v<0n?'-':'')+s.slice(0,-2)+'.'+s.slice(-2);};
/** Source-backed operational view. Never passes synthetic approvals to the closing engine. */
export function operationalProposal(fields:FillField[],c:any,layout:any):OperationalProposal{
 const result:OperationalProposal={formatVersion:'eva-operational-proposal-1.0',state:'UNAVAILABLE',invoice:{amount:null,source:'',lines:[]},acr:{identifiedAmount:null,lines:[]},supplier:{amount:null,source:''},fixedFee:{amount:null,source:''},observations:[],financialApproval:false,canPublish:false};
 const note=(s:string)=>{if(!result.observations.includes(s))result.observations.push(s);};
 if(!(c.ready||c.proposalReady)){note('Vínculo ou leitura da fatura exige reconferência antes de calcular a proposta.');return result;}
 const get=(key:string)=>fields.find(f=>f.key===key&&f.state==='FILLED');
 const source='Fatura '+c.document.id+' · SHA-256 '+c.document.file_hash;
 const rows=Array.isArray(layout?.operations)?layout.operations:[];
 const totals=rows.filter((r:any)=>r.component==='TOTAL_A_PAGAR');
 const verified=(f:any)=>!!f&&money(f.decimal)&&!f.issues?.includes('UNVERIFIED_SOURCE');
 if(layout?.reconciliation?.state==='MATCH'&&totals.length===1&&verified(totals[0].fields?.amount)){
  result.invoice.amount=format(cents(totals[0].fields.amount.decimal));result.invoice.source=source+' · '+totals[0].source;
 }else note('Total da fatura sem conciliação integral; nenhum total foi presumido.');
 if(rows.length<=80){
  result.invoice.lines=rows.filter((r:any)=>['CHARGE','CREDIT','UNKNOWN'].includes(r.role)).map((r:any)=>({key:r.source,label:r.fields.description?.text||'Rubrica sem descrição',amount:verified(r.fields.amount)?format(cents(r.fields.amount.decimal)):null,source:source+' · '+r.source}));
 }else note('Detalhamento da fatura excede o limite desta prévia; consulte o documento original.');
 // The invoice total is evidence, not a sum with the same CIP/credits or tax values again.
 for(const [key,target] of [['supplier:regular','supplier'],['fee:fixed','fixedFee']] as const){const f=get(key);if(f&&money(f.value)&&cents(f.value)>=0n)result[target]={amount:format(cents(f.value)),source:f.source};}
 if(!result.supplier.amount)note('Preço ou valor do fornecedor sem fonte suficiente; confira somente as condições comerciais.');
 const rates=fields.filter(f=>f.key.startsWith('ACR:')&&!f.key.includes(':tax:')&&f.key!=='ACR:library');
 if(!rates.length)note('Biblioteca ACR compatível não disponível para esta competência.');
 for(const f of rates){
  const [,component,band]=f.key.split(':');let quantity:unknown;
  if(['TE','TUSD_ENERGY'].includes(component))quantity=get(({PEAK:'consumptionPeak',OFF_PEAK:'consumptionOffPeak',ALL:'consumptionTotal'} as Record<string,string>)[band])?.value;
  else if(component==='REACTIVE')quantity=get(band==='PEAK'?'reactiveBilledPeakKwh':band==='OFF_PEAK'?'reactiveBilledOffPeakKwh':'reactiveTotal')?.value;
  else if(['TUSD_DEMAND_USED','TUSD_DEMAND_UNUSED'].includes(component))quantity=c.billed?.ACR?.[component==='TUSD_DEMAND_USED'?'used':'unused'];
  // Demand measured, demand billed and contracted demand are distinct. No silent substitution.
  const compatible=['TE','TUSD_ENERGY','REACTIVE'].includes(component)?['BRL_KWH','BRL_MWH'].includes(f.unit)||component==='REACTIVE'&&f.unit==='BRL_KVARH':['TUSD_DEMAND_USED','TUSD_DEMAND_UNUSED'].includes(component)&&f.unit==='BRL_KW';
  const duplicates=rates.filter(r=>r.key===f.key||r.key.split(':')[1]===component&&(r.key.endsWith(':ALL')||band==='ALL'));
  if(f.state!=='FILLED'||!decimal(f.value)||!decimal(quantity)||!compatible||duplicates.length!==1){note('ACR: '+f.label+' aguarda quantidade faturável ou fonte compatível; a rubrica não foi estimada como zero.');continue;}
  try{const product=tariffProduct(quantity,f.value,f.unit==='BRL_MWH');result.acr.lines.push({key:f.key,label:f.label,quantity,measure:f.unit,rate:f.value,amount:product.rounded,source:f.source});}catch{note('ACR: '+f.label+' exige revisão da quantidade ou tarifa.');}
 }
 // Used and unused demand must be a complete pair; do not show one half of a split bill.
 const split=rates.filter(f=>f.key.includes(':TUSD_DEMAND_'));
 if(split.length&&split.some(f=>!result.acr.lines.some(l=>l.key===f.key)))result.acr.lines=result.acr.lines.filter(l=>!l.key.includes(':TUSD_DEMAND_'));
 if(result.acr.lines.length)result.acr.identifiedAmount=format(result.acr.lines.reduce((sum,l)=>sum+cents(l.amount),0n));
 note('ACR: soma apenas das rubricas calculadas da biblioteca; tributos, componentes sem base e demais ajustes não estão presumidos. Não representa custo final ou economia líquida.');
 note('Total da distribuidora, fornecedor e honorários são apresentados separadamente. CIP, créditos e impostos já incluídos na fatura não são somados novamente.');
 if(get('fee:percentage'))note('Honorário percentual preenchido; valor variável final depende da economia consolidada.');
 result.state='PARTIAL';return result;
}
