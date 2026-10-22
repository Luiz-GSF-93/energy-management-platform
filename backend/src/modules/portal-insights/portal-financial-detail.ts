import {feeCents,feeMoney} from '../contracts/services/management-fee';
import {consolidatePublishedComposition} from './portal-composition-summary';
import {decimal,specificPrice} from '../energy-prices/energy-price-score';

const codes = {icmsAmount:'ICMS',pisAmount:'PIS',cofinsAmount:'COFINS'} as const;
function money(value:unknown):bigint {
  if(typeof value!=='string'||! /^-?(0|[1-9]\d{0,11})\.\d{2}$/.test(value))throw Error('Invalid published amount');
  return value.startsWith('-')?-feeCents(value.slice(1)):feeCents(value);
}
/** Presentation only. Never changes a published total or guesses a missing tax. */
export function financialDetail(r:any,original:any){
  const result:any={...original,composition:original.composition,credits:[] as any[],taxes:[] as any[],ccee:[] as any[],costBasis:'BILLED',taxNotice:'Tributos sem segregação integral demonstrada nesta publicação.'};
  const ccee=(Array.isArray(r.cceeCosts)?r.cceeCosts:[]).filter((c:any)=>{try{return c.closingHash===r.sourceHash&&c.state==='PUBLISHED'&&c.provider==='CCEE'&&c.month===r.month&&typeof c.sourceReference==='string'&&c.sourceReference.length>0&&money(c.amount)>=0n;}catch{return false;}});
  if(new Set(ccee.map((c:any)=>c.sourceReference+'|'+c.label)).size!==ccee.length)throw Error('Ambiguous CCEE cost source');
  // These items come from the same immutable published report, never current monthly drafts.
  const publishedItems=Array.isArray(r.publishedCostItems)?r.publishedCostItems:[];
  const publishedGroups=new Map<string,{key:string;label:string;amount:bigint}>();
  let publishedCostsValid=true;
  try {
    if(new Set(publishedItems.map((c:any)=>c.id)).size!==publishedItems.length)throw Error();
    for(const c of publishedItems){
      if(typeof c.id!=='string'||!c.id||!['COST','CREDIT'].includes(c.effect)||typeof c.source!=='string'||!c.source.trim()||['SUPPLIER_INVOICE','SUPPLIER_EXTRA_ENERGY'].includes(c.category)||money(c.amount)<0n)throw Error();
      const key=c.category==='CCEE'?'ccee-published':c.category==='TAX'?'tax-published':'other-published',label=c.category==='CCEE'?'CCEE · encargos e ajustes publicados':c.category==='TAX'?'Tributos adicionais publicados':'Outros custos publicados';
      const before=publishedGroups.get(key);publishedGroups.set(key,{key,label,amount:(before?.amount??0n)+(c.effect==='CREDIT'?-money(c.amount):money(c.amount))});
    }
    if([...publishedGroups.values()].some(c=>c.amount<0n))throw Error();
  }catch{publishedCostsValid=false;publishedGroups.clear();}
  const publishedTotal=[...publishedGroups.values()].reduce((n,c)=>n+c.amount,0n);
  const additional=ccee.filter((c:any)=>c.includedInTotal===true&&c.accountingRole==='ADDITIONAL');
  const additionalTotal=additional.reduce((n:bigint,c:any)=>n+money(c.amount),0n);
  result.unitContext=Object.fromEntries(['freeMarket','state','tariffGroup','tariffSubgroup','tariffModality','voltage'].map(k=>[k,k==='freeMarket'?(typeof r.unitContext?.[k]==='boolean'?r.unitContext[k]:null):(typeof r.unitContext?.[k]==='string'?r.unitContext[k].slice(0,100):null)]));
  let usedPublishedCosts=false;
  // A reconciled gross composition is still useful when the publication lacks tax segregation.
  if(publishedItems.length||additional.length)try{
    const gross=money(r.invoice),supplier=money(r.supplier),fees=money(r.financial.fees),total=money(r.financial.aclAfterFees);
    const extra=publishedItems.length?publishedTotal:additionalTotal;
    if(!publishedCostsValid||gross<0n||supplier<0n||fees<0n||total<=0n||gross+supplier+fees+extra!==total)throw Error();
    usedPublishedCosts=publishedItems.length>0;
    const extras=usedPublishedCosts?[...publishedGroups.values()].map(c=>({key:c.key,label:c.label,amount:feeMoney(c.amount)})):additional.map((c:any,i:number)=>({key:'ccee-'+i,label:'CCEE · '+c.label,amount:c.amount}));
    result.composition=consolidatePublishedComposition([{composition:[{key:'distributor',label:'Fatura da distribuidora',amount:r.invoice},{key:'supplier',label:'Energia do fornecedor',amount:r.supplier},{key:'fees',label:'Honorários da gestão',amount:r.financial.fees},...extras]}]);
    result.compositionNotice='Componentes conciliados ao total publicado. Tributos não segregados permanecem incluídos nas parcelas originais.';
  }catch{result.composition=null;}
  const taxRows=Array.isArray(r.invoiceTaxes)?r.invoiceTaxes:[];
  try {
    if(taxRows.length!==3||new Set(taxRows.map((t:any)=>t.code)).size!==3)throw Error();
    const taxes=Object.entries(codes).map(([code,label])=>{
      const row=taxRows.find((t:any)=>t.code===code);
      if(!row||row.method!=='PRESERVED_INVOICE_AMOUNT'||money(row.amount)<0n||!Array.isArray(row.cells)||row.cells.length===0||row.cells.reduce((sum:bigint,c:any)=>sum+money(c.amount),0n)!==money(row.amount))throw Error();
      return {key:code,label,amount:row.amount,printedRate:row.printedRate??null};
    });
    const taxTotal=taxes.reduce((sum,t)=>sum+money(t.amount),0n),gross=money(r.invoice),supplier=money(r.supplier),fees=money(r.financial.fees),total=money(r.financial.aclAfterFees);
    const hasPublishedCosts=publishedItems.length>0;
    const extra=hasPublishedCosts?publishedTotal:additionalTotal;
    if(!publishedCostsValid||gross<taxTotal||gross+supplier+fees+extra!==total||total<=0n)throw Error();
    usedPublishedCosts=hasPublishedCosts;
    const values=[{key:'distributor',label:'Distribuidora · valor sem ICMS, PIS e COFINS',amount:feeMoney(gross-taxTotal)},...taxes,{key:'supplier',label:'Energia do fornecedor · base fiscal informada no fechamento',amount:r.supplier},{key:'fees',label:'Honorários da gestão',amount:r.financial.fees},...(usedPublishedCosts?[...publishedGroups.values()].map(c=>({key:c.key,label:c.label,amount:feeMoney(c.amount)})):additional.map((c:any,i:number)=>({key:'ccee-'+i,label:'CCEE · '+c.label,amount:c.amount})))];
    const shares=values.map(p=>money(p.amount)*10000n/total),largest=values.reduce((best,p,i)=>money(p.amount)>money(values[best].amount)?i:best,0);
    shares[largest]+=10000n-shares.reduce((sum,n)=>sum+n,0n);
    let offset=0n;
    result.composition=values.map((part,i)=>{if(money(part.amount)<0n)throw Error();const share=shares[i];const p={...part,percent:feeMoney(share),offset:feeMoney(offset)};offset+=share;return p;});
    result.taxes=taxes;
    result.taxNotice='ICMS, PIS e COFINS da distribuidora foram retirados da parcela bruta antes de serem separados. Tributos do fornecedor sem segregação permanecem identificados na parcela correspondente; não foram presumidos.';
    result.compositionNotice='Total publicado preservado. Valores faturados/apurados não comprovam pagamento. '+result.taxNotice;
  } catch {result.compositionNotice=result.compositionNotice+' '+result.taxNotice;}
  // CCEE items must be tied to this exact immutable closing; never add them to an old total.
  result.ccee=ccee.map((c:any)=>({label:c.label,amount:c.amount,month:c.month,paymentStatus:c.paymentStatus==='CONFIRMED'&&/^[a-f0-9]{64}$/.test(c.paymentEvidenceHash??'')?'CONFIRMED':'NOT_DEMONSTRATED',includedInTotal:result.composition?.some((p:any)=>p.key.startsWith('ccee-'))&&additional.includes(c),source:c.sourceReference}));
  if(usedPublishedCosts&&result.composition)result.ccee=publishedItems.filter((c:any)=>c.category==='CCEE').map((c:any)=>({label:c.label,amount:c.amount,month:r.month,paymentStatus:'NOT_DEMONSTRATED',includedInTotal:true}));
  result.credits=(r.retained??[]).filter((c:any)=>{try{return money(c.amount)<0n;}catch{return false;}}).map((c:any)=>({label:c.label,amount:c.amount,notice:'Crédito já considerado no saldo da fatura; não é somado novamente.'}));
  try {
    const fields=new Map((r.fields??[]).map((f:any)=>[f.key,f.value]));
    const kwh=decimal(fields.get('consumptionTotal'));
    if(kwh<=0n||decimal(fields.get('consumptionPeak'))+decimal(fields.get('consumptionOffPeak'))!==kwh)throw Error();
    result.prices={...original.prices,aclObserved:specificPrice(money(r.supplier),kwh),aclTaxBasis:String(fields.get('supplier:tax')??'UNKNOWN'),kwh:String(fields.get('consumptionTotal')),notice:'Preço observado = energia do fornecedor ÷ consumo publicado × 1.000. Não inclui TUSD, demanda ou honorários. Classificação fiscal desconhecida não impede exibir o preço; impede tratá-lo como líquido para o score.'};
  }catch {result.prices={...original.prices,aclObserved:null,aclTaxBasis:'UNKNOWN'};}
  return result;
}
