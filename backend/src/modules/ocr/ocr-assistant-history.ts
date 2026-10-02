/** Decimal comparison for operational alerts only. No monetary calculation or inferred zeros. */
function scaled(value:unknown):bigint|null {
 if(typeof value!=='string'||!/^\d{1,12}(?:[.]\d{1,6})?$/.test(value))return null;
 const [a,b='']=value.split('.');return BigInt(a)*1000000n+BigInt(b.padEnd(6,'0'));
}
export function assistantHistory(consumption:unknown,rows:{id:string;month:string;version:number;revision:number;status:string;measurements?:{consumptionTotal?:unknown}}[]) {
 const current=scaled(consumption),months=new Set<string>();
 return rows.filter(r=>{const month=String(r.month).slice(0,7);if(r.status!=='VALIDATED'||months.has(month))return false;months.add(month);return true;}).slice(0,3).map(r=>{
  const previous=scaled(r.measurements?.consumptionTotal),delta=current!==null&&previous!==null?current-previous:null;
  const alert=delta!==null&&previous!==null&&previous>0n&&(delta<0n?-delta:delta)*100n>previous*25n;
  return {inputId:r.id,month:String(r.month).slice(0,7),version:r.version,revision:r.revision,previous:r.measurements?.consumptionTotal??null,current:consumption??null,unit:'kWh',
   state:current===null||previous===null?'MISSING_DATA':previous===0n?'ZERO_REFERENCE':alert?'REVIEW_VARIATION':'COMPARABLE',
   message:current===null||previous===null?'Histórico incompleto; ausência não foi convertida em zero.':previous===0n?'Referência explicitamente zero; variação percentual não foi calculada.':alert?'Variação de consumo superior a 25% frente ao mês indicado. Alerta operacional para revisão, sem corrigir valores ou bloquear por si só.':'Consumo dentro do limiar operacional de 25%. Comparação não comprova correção da fatura.'};
 });
}
