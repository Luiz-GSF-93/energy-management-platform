import {feeCents,feeMoney} from '../contracts/services/management-fee';
import {decimal} from './energy-price-score';

/** Price projections only; never a supplier quote or a tax-normalized comparison. */
export function pldSpreadScenarios(value: string | null) {
  const estimate = (percent: 5 | 10 | 15) => {
    if (value === null) return null;
    const scaled = decimal(value) * BigInt(100 + percent);
    return feeMoney((scaled + 500000000n) / 1000000000n);
  };
  return {
    pldSpread5: estimate(5),
    pldSpread10: estimate(10),
    pldSpread15: estimate(15),
  };
}

/** Nominal price comparison, never settlement savings or a supplier quote. */
export function observedPriceComparisons(acl:string|null,aclNet:string|null,acr:string|null,pld:string|null,spreads:ReturnType<typeof pldSpreadScenarios>,acrBasis:'NET'|'GROSS'){
 const percent=(actual:string|null,reference:string|null)=>{
  if(actual===null||reference===null)return null;
  const base=feeCents(reference);if(base<=0n)return null;
  const delta=feeCents(actual)-base,absolute=delta<0n?-delta:delta;
  return (delta<0n?'-':'')+feeMoney((absolute*10000n+base/2n)/base);
 };
 return [{key:'acr',label:'Perfil ACR · referência TE',reference:acr},{key:'pld',label:'PLD · CCEE',reference:pld},{key:'pldSpread5',label:'PLD + 5% estimado',reference:spreads.pldSpread5},{key:'pldSpread10',label:'PLD + 10% estimado',reference:spreads.pldSpread10},{key:'pldSpread15',label:'PLD + 15% estimado',reference:spreads.pldSpread15}].map(r=>{
  const actual=r.key==='acr'&&acrBasis==='GROSS'?acl:aclNet??acl;
  return {key:r.key,label:r.label,percent:percent(actual,r.reference),basis:aclNet!==null&&(r.key!=='acr'||acrBasis==='NET')?'NET_COMPARABLE':r.key==='acr'&&acrBasis==='GROSS'?'GROSS_COMPARABLE':'NOMINAL_UNCONFIRMED'};
 });
}
