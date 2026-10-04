import {spotSupplierCost} from '../contracts/services/spot-supplier-cost';
/** Read-only proposal using current confirmed consumption. Never validates a draft. */
export function ocrSupplierProposal(supplier:any,measurements:any,unit:any,month:string,ready:boolean){
 const unavailable={amount:supplier?.regularAmount??null,difference:supplier?.volumeDifferenceMwh??null};
 if(!ready||supplier?.formulaVersion!=='spot-supplier-1.0'||!supplier.contract||!supplier.rule)return unavailable;
 const decimal=(v:any)=>typeof v==='string'&&/^(0|[1-9][0-9]{0,11})([.]\d{1,12})?$/.test(v);
 if(!decimal(supplier.contractedMwh)||!decimal(supplier.pricePerMwh)||['consumptionTotal','consumptionPeak','consumptionOffPeak'].some(k=>!decimal(measurements?.[k])||String(measurements[k]).split('.')[1]?.length>6))return unavailable;
 const scaled=(v:string)=>{const [w,f='']=v.split('.');return BigInt(w)*10n**12n+BigInt(f.padEnd(12,'0'));};
 const proposal=spotSupplierCost({requirements:[],warnings:[],taxTreatment:supplier.taxTreatment,measurements:{measurements}},unit,month,scaled(supplier.contractedMwh),scaled(supplier.pricePerMwh),[]);
 return {amount:proposal.regularAmount??unavailable.amount,difference:proposal.volumeDifferenceMwh??unavailable.difference};
}
