import type {CpflOperation} from './cpfl-paulista-layout';
import {reconcileCpflOperations} from './cpfl-reconciliation';

/** A derived sign interpretation. Original text, spans and confidence stay intact. */
export function cpflCreditMagnitudes(rows:CpflOperation[],verified:(row:CpflOperation)=>boolean){
 const unchanged={operations:rows,proof:null as null|{method:string;sources:string[];printedAmounts:string[]}};
 if(reconcileCpflOperations(rows).state==='MATCH')return unchanged;
 const monetary=rows.filter(r=>['CHARGE','CREDIT','TOTAL'].includes(r.role));
 if(!monetary.length||monetary.some(r=>!r.source||!verified(r))||new Set(monetary.map(r=>r.source)).size!==monetary.length)return unchanged;
 const distributor=rows.findIndex(r=>r.component==='TOTAL_DISTRIBUIDORA'),total=rows.findIndex(r=>r.component==='TOTAL_A_PAGAR');
 if(distributor<0||total<=distributor)return unchanged;
 const changed:CpflOperation[]=[];
 const operations=rows.map((r,index)=>{
  const amount=r.fields.amount?.decimal;
  if(index<=distributor||index>=total||r.role!=='CREDIT'||!['ACL_ENERGY_DISCOUNT','SUBSIDY_CREDIT','REFUND'].includes(r.component)||typeof amount!=='string'||!/^\d+(?:\.\d{1,2})?$/.test(amount)||!/[1-9]/.test(amount))return r;
  const label=r.fields.description?.text.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toUpperCase().trim()??'';
  if(!(r.component==='ACL_ENERGY_DISCOUNT'&&/^DESC ENERGIA ACL\b/.test(label)||r.component==='SUBSIDY_CREDIT'&&/^CREDITO SUBVENCAO\b/.test(label)||r.component==='REFUND'&&/^(?:DEVOL(?:UCAO)?|RESSARCIMENTO (?:DIC|FIC|DMIC|DICRI))\b/.test(label)))return r;
  changed.push(r);return {...r,fields:{...r.fields,amount:{...r.fields.amount,decimal:'-'+amount}}};
 });
 if(!changed.length||reconcileCpflOperations(operations).state!=='MATCH')return unchanged;
 return {operations,proof:{method:'CPFL_CREDIT_LABELS_AND_EXACT_TOTALS',sources:changed.map(r=>r.source),printedAmounts:changed.map(r=>r.fields.amount.text)}};
}
