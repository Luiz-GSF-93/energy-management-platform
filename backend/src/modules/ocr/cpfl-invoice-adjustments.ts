import type {CpflOperation} from './cpfl-paulista-layout';
export type InvoiceAdjustments={state:'RECONCILED'|'REVIEW_REQUIRED';total:string|null;tariffs:string|null;cip:string|null;cipSource:string|null;items:{source:string;label:string;component:string;effect:'COST'|'CREDIT';amount:string}[];issues:string[]};
const cents=(v:unknown)=>{if(typeof v!=='string'||! /^-?(0|[1-9][0-9]*)([.][0-9]{1,2})?$/.test(v)||v.length>30)throw Error('Valor monetário ausente ou inválido.');const negative=v.startsWith('-'),[a,b='']=(negative?v.slice(1):v).split('.');return (BigInt(a)*100n+BigInt(b.padEnd(2,'0')))*(negative?-1n:1n);};
const money=(n:bigint)=>{const s=(n<0n?-n:n).toString().padStart(3,'0');return (n<0n?'-':'')+s.slice(0,-2)+'.'+s.slice(-2);};
/** Reconciles invoice operations; subtotals and informative duplicates never become expenses. */
export function cpflInvoiceAdjustments(operations:CpflOperation[],requireCip=true):InvoiceAdjustments{
 const r:InvoiceAdjustments={state:'REVIEW_REQUIRED',total:null,tariffs:null,cip:null,cipSource:null,items:[],issues:[]};
 try{
  const totals=operations.filter(o=>o.component==='TOTAL_A_PAGAR'&&o.role==='TOTAL');
  if(totals.length!==1)throw Error('Exige um único total a pagar.');
  const amount=(o:CpflOperation)=>{const f=o.fields.amount;if(!f||f.issues.includes('UNVERIFIED_SOURCE')||o.issues.some(i=>['MERGED_OR_DUPLICATE_CELL','UNMAPPED_COLUMN'].includes(i)))throw Error('Valor da operação exige revisão: '+o.source);return cents(f.decimal);};
  const total=amount(totals[0]);if(total<0n)throw Error('Total negativo exige tratamento específico.');
  if(operations.some(o=>o.role==='UNKNOWN'&&o.fields.amount?.text?.trim()))throw Error('Operação monetária não classificada.');
  const rows=operations.filter(o=>['CHARGE','CREDIT'].includes(o.role));
  if(!rows.length||new Set(rows.map(o=>o.source)).size!==rows.length)throw Error('Operações ausentes ou duplicadas.');
  let sum=0n,tariffs=0n,acl=0n;const lights:typeof rows=[];
  for(const o of rows){const n=amount(o);if(o.role==='CREDIT'&&n>0n||o.role==='CHARGE'&&n<0n)throw Error('Sinal da operação incompatível.');sum+=n;
   if(['TUSD_ENERGY','DEMAND_BILLED','REACTIVE_ENERGY','CDE_WATER_SCARCITY','TARIFF_FLAG','TE'].includes(o.component))tariffs+=n;
   else if(['ACL_DISTRIBUTOR_INFORMATION','ACL_ENERGY_DISCOUNT'].includes(o.component))acl+=n;
   else if(o.component==='PUBLIC_LIGHTING')lights.push(o);
   else if(['TARIFF_SUBSIDY','SUBSIDY_CREDIT','REFUND'].includes(o.component))r.items.push({source:o.source,label:o.fields.description?.text||o.component,component:o.component,effect:n<0n?'CREDIT':'COST',amount:money(n<0n?-n:n)});
   else throw Error('Componente monetário sem integração: '+o.component);
  }
  if(acl!==0n)throw Error('Energia ACL e descontos não se anulam.');
  if(requireCip&&lights.length!==1||lights.length>1)throw Error('CIP ausente ou ambígua.');
  if(sum!==total)throw Error('As operações não conciliam com o total a pagar.');
  Object.assign(r,{state:'RECONCILED',total:money(total),tariffs:money(tariffs),cip:lights.length?money(amount(lights[0])):null,cipSource:lights[0]?.source??null});
 }catch(e){r.items=[];r.issues.push(e instanceof Error?e.message:'Conciliação indisponível.');}
 return r;
}
