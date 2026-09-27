type Review={id:string;sourceHash:string;decision:string;author:string;createdAt:string;version:number};
type Field={key:string;source:string;label:string;sourceHash:string;state:string;unit:string;decimal:string|null;history:Review[]};
/** Only the latest human decision for the current immutable evidence contributes. */
export function reviewedDemandSummary(fields:Field[]){
 const rows=fields.map(f=>{const latest=f.history[0];let state='PENDING';
 if(fields.filter(v=>v.key===f.key||v.source===f.source).length!==1||f.state!=='BILLED_UNCLASSIFIED'||f.unit!=='kW'||typeof f.decimal!=='string'||!/^\d{1,24}(?:\.\d{1,9})?$/.test(f.decimal))state='CONFLICT';
 else if(latest&&latest.sourceHash!==f.sourceHash)state='STALE';
 else if(latest?.decision==='NEEDS_CORRECTION')state='NEEDS_CORRECTION';
 else if(latest&&['USED','UNUSED'].includes(latest.decision))state=latest.decision;
 return {key:f.key,label:f.label,source:f.source,decimal:f.decimal,state,review:latest?{id:latest.id,version:latest.version,author:latest.author,createdAt:latest.createdAt}:null};
 });
 const complete=rows.length>0&&rows.every(r=>['USED','UNUSED'].includes(r.state));
 const sum=(kind:string)=>{let total=0n;for(const r of rows.filter(v=>v.state===kind)){const [a,b='']=r.decimal!.split('.');total+=BigInt(a)*1000000000n+BigInt(b.padEnd(9,'0'));}return (total/1000000000n).toString()+'.'+(total%1000000000n).toString().padStart(9,'0').replace(/0{1,5}$/,'');};
 return {canImport:false as const,state:!rows.length?'EMPTY':complete?'COMPLETE':'PENDING',usedKw:complete?sum('USED'):null,unusedKw:complete?sum('UNUSED'):null,reviewed:rows.filter(r=>['USED','UNUSED'].includes(r.state)).length,total:rows.length,rows,message:'Classificação das parcelas faturadas conferidas. Não representa demanda medida nem aprova identidade, tributos, contrato ou cálculo.'};
}
