import type {CpflOperation} from './cpfl-paulista-layout';
/** Arithmetic checks are evidence, not approval. Summary lines are never added twice. */
export function reconcileCpflOperations(rows:CpflOperation[]){
 const checks:{label:string;state:string;differenceCents:string|null}[]=[];
 const cents=(r:CpflOperation)=>{const v=r.fields.amount?.decimal;if(!v||!/^[-]?[0-9]+(?:\.[0-9]{1,2})?$/.test(v))return null;const [a,b='']=v.split('.');return BigInt(a+b.padEnd(2,'0'));};
 const unique=(component:string)=>{const found=rows.filter(r=>r.component===component);return found.length===1?found[0]:null;};
 let creditMagnitude:CpflOperation|null=null;
 const effectiveCents=(r:CpflOperation)=>r===creditMagnitude?-cents(r)!:cents(r);
 const check=(label:string,expected:CpflOperation|null,terms:CpflOperation[])=>{if(!expected||!terms.length||cents(expected)===null||terms.some(r=>cents(r)===null||!r.fields.description?.text.trim())){checks.push({label,state:'NOT_VERIFIABLE',differenceCents:null});return;}
  const diff=terms.reduce((sum,r)=>sum+effectiveCents(r)!,0n)-effectiveCents(expected)!;checks.push({label,state:diff===0n?'MATCH':'DIVERGENT',differenceCents:diff.toString()});};
 const subtotal=unique('SUBTOTAL'),distributor=unique('TOTAL_DISTRIBUIDORA'),adjustments=unique('ADJUSTMENTS_SUBTOTAL'),total=unique('TOTAL_A_PAGAR');
 const index=(r:CpflOperation|null)=>r?rows.indexOf(r):-1;
 const ordered=index(subtotal)>=0&&index(distributor)>index(subtotal)&&index(adjustments)>index(distributor)&&index(total)>index(adjustments);
 if(!ordered)return {state:'NOT_VERIFIABLE',checks:[{label:'Sequência de subtotais e total',state:'NOT_VERIFIABLE',differenceCents:null}]};
 check('Soma das operações até o subtotal',subtotal,rows.slice(0,index(subtotal)));
 check('Subtotal versus total distribuidora',distributor,[subtotal!]);
 // Some CPFL invoices print the credit subtotal as an unsigned magnitude.
 // Interpret it only when every detailed signed amount and the final invoice agree.
 const detail=rows.slice(index(distributor)+1,index(adjustments));
 const after=rows.slice(index(adjustments)+1,index(total));
 const complete=(items:CpflOperation[])=>items.every(r=>cents(r)!==null&&r.fields.description?.text.trim()&&['CHARGE','CREDIT'].includes(r.role));
 if(adjustments&&cents(adjustments)!==null&&cents(adjustments)!>0n&&detail.length&&complete(detail)&&complete(after)&&cents(distributor!)!==null&&cents(total!)!==null){
  const signed=detail.reduce((sum,r)=>sum+cents(r)!,0n);
  if(signed===-cents(adjustments)!&&cents(distributor!)!+signed+after.reduce((sum,r)=>sum+cents(r)!,0n)===cents(total!))creditMagnitude=adjustments;
 }
 check('Ajustes detalhados versus devolução',adjustments,rows.slice(index(distributor)+1,index(adjustments)));
 check('Total distribuidora + devolução + demais ajustes',total,[distributor!,adjustments!,...rows.slice(index(adjustments)+1,index(total))]);
 return {interpretation:creditMagnitude?'CREDIT_SUBTOTAL_PRINTED_AS_MAGNITUDE':'SIGNED_SUBTOTAL',state:checks.every(c=>c.state==='MATCH')?'MATCH':checks.some(c=>c.state==='DIVERGENT')?'DIVERGENT':'NOT_VERIFIABLE',checks};
}
