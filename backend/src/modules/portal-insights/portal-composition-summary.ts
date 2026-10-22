import {feeCents,feeMoney} from '../contracts/services/management-fee';
type Part={key:string;label:string;amount:string};
export function consolidatePublishedComposition(rows:{composition:Part[]|null}[]){
 if(!rows.length||rows.some(r=>!r.composition?.length))return null;
 const grouped=new Map<string,{label:string;amount:bigint}>();
 for(const row of rows)for(const part of row.composition!){if(!/^(0|[1-9]\d{0,11})\.\d{2}$/.test(part.amount))return null;const before=grouped.get(part.key);if(before&&before.label!==part.label)return null;grouped.set(part.key,{label:part.label,amount:(before?.amount??0n)+feeCents(part.amount)});}
 const entries=[...grouped],total=entries.reduce((n,[,v])=>n+v.amount,0n);if(total<=0n)return null;let offset=0n;
 const shares=entries.map(([,v],index)=>({index,share:v.amount*10000n/total,remainder:v.amount*10000n%total}));
 const order=[...shares].sort((a,b)=>a.remainder===b.remainder?a.index-b.index:a.remainder>b.remainder?-1:1);
 const remaining=Number(10000n-shares.reduce((n,v)=>n+v.share,0n));for(let i=0;i<remaining;i++)order[i].share++;
 return entries.map(([key,v],i)=>{const share=shares[i].share,result={key,label:v.label,amount:feeMoney(v.amount),percent:feeMoney(share),offset:feeMoney(offset)};offset+=share;return result;});
}
