import {feeCents,feeMoney} from '../contracts/services/management-fee';
type Part={key:string;label:string;amount:string};
export function consolidatePublishedComposition(rows:{composition:Part[]|null}[]){
 if(!rows.length||rows.some(r=>!r.composition?.length))return null;
 const taxKeys=['icmsAmount','pisAmount','cofinsAmount'];
 const detailed=rows.map(r=>taxKeys.every(key=>r.composition!.some(p=>p.key===key)));
 if(detailed.some(Boolean)&&detailed.some(v=>!v)){
  // Mixed historical detail is consolidated at the common gross-invoice level.
  // Never add a net distributor category to an unsegregated gross invoice.
  rows=rows.map(row=>{const parts=row.composition!,invoice=parts.filter(p=>p.key==='distributor'||taxKeys.includes(p.key));
   if(!invoice.some(p=>p.key==='distributor')||invoice.some(p=>!/^(0|[1-9]\d{0,11})\.\d{2}$/.test(p.amount)))return {composition:null};
   return {composition:[{key:'distributor',label:'Distribuidora · tributos incluídos',amount:feeMoney(invoice.reduce((n,p)=>n+feeCents(p.amount),0n))},...parts.filter(p=>p.key!=='distributor'&&!taxKeys.includes(p.key)).map(p=>p.key==='supplier'?{...p,label:'Energia do fornecedor · valores publicados'}:p)]};
  });
  if(rows.some(r=>!r.composition))return null;
 }
 const grouped=new Map<string,{label:string;amount:bigint}>();
 for(const row of rows)for(const part of row.composition!){if(!/^(0|[1-9]\d{0,11})\.\d{2}$/.test(part.amount))return null;const before=grouped.get(part.key);if(before&&before.label!==part.label)return null;grouped.set(part.key,{label:part.label,amount:(before?.amount??0n)+feeCents(part.amount)});}
 const entries=[...grouped],total=entries.reduce((n,[,v])=>n+v.amount,0n);if(total<=0n)return null;let offset=0n;
 const shares=entries.map(([,v],index)=>({index,share:v.amount*10000n/total,remainder:v.amount*10000n%total}));
 const order=[...shares].sort((a,b)=>a.remainder===b.remainder?a.index-b.index:a.remainder>b.remainder?-1:1);
 const remaining=Number(10000n-shares.reduce((n,v)=>n+v.share,0n));for(let i=0;i<remaining;i++)order[i].share++;
 return entries.map(([key,v],i)=>{const share=shares[i].share,result={key,label:v.label,amount:feeMoney(v.amount),percent:feeMoney(share),offset:feeMoney(offset)};offset+=share;return result;});
}
