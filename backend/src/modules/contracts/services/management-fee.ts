export function feeCents(value:unknown):bigint {const s=String(value);if(!/^(0|[1-9][0-9]{0,11})([.][0-9]{1,2})?$/.test(s))throw Error('Valor monetário inválido');const [a,b='']=s.split('.');return BigInt(a)*100n+BigInt(b.padEnd(2,'0'));}
export function feeMoney(v:bigint):string {const s=(v<0n?-v:v).toString().padStart(3,'0');return (v<0n?'-':'')+s.slice(0,-2)+'.'+s.slice(-2);}
export function allocationUnits(value:unknown):bigint {if(typeof value!=='string'||!/^(100([.]0{1,4})?|[0-9]{1,2}([.][0-9]{1,4})?)$/.test(value))throw Error('Percentual inválido');const [a,b='']=value.split('.');return BigInt(a)*10000n+BigInt(b.padEnd(4,'0'));}
/** Largest remainder assigns every cent exactly once; UUID breaks equal remainders. */
export function allocateFee(amount:unknown,items:{consumerUnitId:string;percentage:string}[]) {
 const total=feeCents(amount);if(!items.length||new Set(items.map(i=>i.consumerUnitId)).size!==items.length)throw Error('Rateio duplicado ou vazio');
 const parts=items.map(i=>{const weight=allocationUnits(i.percentage),product=total*weight;return {...i,cents:product/1000000n,remainder:product%1000000n,weight};});
 if(parts.reduce((s,i)=>s+i.weight,0n)!==1000000n)throw Error('O rateio precisa somar 100%');
 let residual=total-parts.reduce((s,i)=>s+i.cents,0n);for(const part of [...parts].sort((a,b)=>a.remainder===b.remainder?a.consumerUnitId.localeCompare(b.consumerUnitId):a.remainder>b.remainder?-1:1)){if(residual--<=0n)break;part.cents++;}
 return parts.map(({consumerUnitId,percentage,cents})=>({consumerUnitId,percentage,amount:feeMoney(cents)}));
}
