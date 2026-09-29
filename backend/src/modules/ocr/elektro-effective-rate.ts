import {tariffProduct} from '../contracts/services/tariff-preview';
/** Effective invoice cost rate, never the regulated tariff. Bound by printed rate precision. */
export function elektroEffectiveRate(quantity:string,printedRate:string,amount:string){
 if(!/^\d+(?:[.]\d{1,6})?$/.test(quantity)||!/^\d+[.]\d{6}$/.test(printedRate)||!/^\d+[.]\d{2}$/.test(amount))return null;
 const parts=(s:string)=>{const [a,b='']=s.split('.');return {n:BigInt(a+b),d:10n**BigInt(b.length)};};
 const q=parts(quantity),r=parts(printedRate),c=BigInt(amount.replace('.',''));if(q.n===0n)return null;
 const delta=c*q.d*r.d-q.n*r.n*100n,abs=delta<0n?-delta:delta;
 if(2n*abs>q.n*100n+q.d*r.d)return null;
 const n=c*10000000n*q.d,scaled=(2n*n+q.n)/(2n*q.n),rate=(scaled/1000000n).toString()+'.'+(scaled%1000000n).toString().padStart(6,'0');
 if(tariffProduct(quantity,rate,true).rounded!==amount)return null;
 return {rateMwh:rate,basis:'BILLED_EFFECTIVE' as const,printedRateKwh:printedRate,explanation:'Tarifa efetiva da operação = valor faturado / quantidade. A diferença cabe na precisão de seis casas da tarifa impressa. Não é alteração da tarifa ANEEL; original preservada.'};
}
