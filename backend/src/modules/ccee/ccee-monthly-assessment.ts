export type MonthlyMarketPrice={month:string;submarket:string;value:string;hours:number;expectedHours:number;origin:string;source:string;hash:string};
const monthNumber=(v:string)=>Number(v.slice(0,4))*12+Number(v.slice(5,7))-1;
const mean=(a:number[])=>a.reduce((sum,v)=>sum+v,0)/a.length;
const pct=(a:number,b:number)=>b>0?((a-b)/b*100).toFixed(2):null;
export function marketMonthlyAssessment(input:MonthlyMarketPrice[],asOf:string){
 const rows=[...input].sort((a,b)=>a.month.localeCompare(b.month));const seen=new Set<string>();
 for(const r of rows){if(!/^20\d{2}-(0[1-9]|1[0-2])-01$/.test(r.month)||seen.has(r.month)||!/^\d{1,8}(\.\d{1,6})?$/.test(r.value)||!Number.isInteger(r.hours)||r.hours!==r.expectedHours||r.expectedHours!==new Date(Date.UTC(Number(r.month.slice(0,4)),Number(r.month.slice(5,7)),0)).getUTCDate()*24||new Date(Date.UTC(Number(r.month.slice(0,4)),Number(r.month.slice(5,7)),0)).toISOString().slice(0,10)>asOf)throw Error('INVALID_MONTHLY_MARKET_HISTORY');seen.add(r.month);}
 const last=rows.at(-1),previous=rows.at(-2),recent:MonthlyMarketPrice[]=[];
 for(let i=rows.length-1;i>=0&&recent.length<3;i--){if(recent.length&&monthNumber(recent.at(-1)!.month)-monthNumber(rows[i].month)!==1)break;recent.push(rows[i]);}recent.reverse();
 const history=rows.slice(-12),values=history.map(r=>Number(r.value)),reference=recent.length?mean(recent.map(r=>Number(r.value))):null;
 const quantile=(p:number)=>{const a=[...values].sort((x,y)=>x-y),index=(a.length-1)*p,l=Math.floor(index);return a[l]+(a[Math.ceil(index)]-a[l])*(index-l);};
 const low=values.length>=6?quantile(.25):null,high=values.length>=6?quantile(.75):null;
 const continuous=rows.length>=24&&rows.slice(-24).every((r,i,a)=>!i||monthNumber(r.month)-monthNumber(a[i-1].month)===1);
 const equivalent=last?rows.find(r=>monthNumber(r.month)===monthNumber(last.month)-12):null;
 return {formulaVersion:'CCEE_MONTHLY_ADVISORY_1',state:last?'AVAILABLE':'NO_COMPLETE_MONTHS',asOf,observations:rows.length,lastMonth:last?.month??null,lastPrice:last?.value??null,
  previousMonth:previous&&last&&monthNumber(last.month)-monthNumber(previous.month)===1?previous.month:null,
  monthChangePercent:previous&&last&&monthNumber(last.month)-monthNumber(previous.month)===1?pct(Number(last.value),Number(previous.value)):null,
  reference:reference===null?null:reference.toFixed(6),referenceMonths:recent.map(r=>r.month),historicalAverage:values.length?mean(values).toFixed(6):null,
  recentVsHistoryPercent:reference!==null&&values.length?pct(reference,mean(values)):null,
  lowerBand:low===null?null:low.toFixed(6),upperBand:high===null?null:high.toFixed(6),bandMonths:history.map(r=>r.month),
  position:last&&low!==null&&high!==null?(Number(last.value)<=low?'LOWER':Number(last.value)>=high?'UPPER':'MIDDLE'):'INSUFFICIENT_SAMPLE',
  lowerObservedMonths:low===null?[]:history.filter(r=>Number(r.value)<=low).map(r=>r.month),upperObservedMonths:high===null?[]:history.filter(r=>Number(r.value)>=high).map(r=>r.month),
  sensitivity:reference===null?[]:[-15,-10,-5,0,5,10,15].map(percent=>({percent,value:(reference*(1+percent/100)).toFixed(6),kind:'CONDITIONAL'})),
  seasonality:continuous?'COMPARABLE_HISTORY':'INSUFFICIENT_HISTORY',yearOnYearPercent:continuous&&last&&equivalent?pct(Number(last.value),Number(equivalent.value)):null,
  sources:rows,notice:'Referências mensais completas, separadas dos preços diários/horários. Faixas P25/P75 descrevem meses observados; cenários percentuais são condicionais sobre a média recente e não uma previsão de data ou garantia de preço.'};
}
