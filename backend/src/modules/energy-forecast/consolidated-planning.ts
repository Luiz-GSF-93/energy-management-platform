import {planningDifference} from './annual-planning';
import {decimal,quantity} from './consumption-forecast';
import {reportHash} from '../reports/report.projection';
/** Adds documented unit series, never forecasts missing units as zero. */
export function consolidatedPlanning(plans:any[],unitIds:string[]){
 if(unitIds.length<2)return null;
 const selected=unitIds.map(id=>plans.find(p=>p.unitId===id)?.annualComparison??null);
 const available=selected.filter(p=>p?.state==='AVAILABLE');
 const years=[...new Set<number>(available.flatMap(p=>p.years.map((y:any)=>y.year)))].sort();
 const sum=(values:any[])=>values.length===unitIds.length&&values.every(v=>typeof v==='string')?decimal(values.reduce((n,v)=>n+quantity(v),0n)):null;
 const result=years.map(year=>{
  const rows=Array.from({length:12},(_,i)=>{
   const month=year+'-'+String(i+1).padStart(2,'0'),sources=selected.map(p=>p?.years.find((y:any)=>y.year===year)?.rows.find((r:any)=>r.month===month));
   const get=(key:string)=>sum(sources.map(r=>r?.[key]));
   const previousKwh=get('previousKwh'),simulatedKwh=get('simulatedKwh'),publishedKwh=get('publishedKwh');
   return {month,previousKwh,simulatedKwh,publishedKwh,previousOrigin:previousKwh===null?null:'CONSOLIDATED_SOURCES',origin:publishedKwh===null?null:'CONSOLIDATED_SOURCES',billedDays:null,previousDays:null,projectedDays:new Date(Date.UTC(year,i+1,0)).getUTCDate(),historyMonths:sources.every(Boolean)?Math.min(...sources.map(r=>r.historyMonths)):0,historyFrom:null,historyTo:null,expansionKwh:get('expansionKwh')??'0.000000',currentDailyKwh:get('currentDailyKwh'),previousDailyKwh:get('previousDailyKwh'),difference:planningDifference(publishedKwh,previousKwh),versusSimulation:planningDifference(publishedKwh,simulatedKwh),dailyDifference:planningDifference(get('currentDailyKwh'),get('previousDailyKwh'))};
  });
  const comparable=rows.filter(r=>r.publishedKwh!==null&&r.previousKwh!==null),estimates=rows.map(r=>r.publishedKwh??r.simulatedKwh).filter((v):v is string=>v!==null);
  const total=(v:string[])=>v.length?decimal(v.reduce((n,s)=>n+quantity(s),0n)):null;
  const current=total(comparable.map(r=>r.publishedKwh!)),previous=total(comparable.map(r=>r.previousKwh!));
  return {year,rows,estimatedYearKwh:total(estimates),estimatedMonths:estimates.length,comparableMonths:comparable.length,comparableDifference:planningDifference(current,previous),comparableCurrentKwh:current,comparablePreviousKwh:previous};
 });
 return {state:result.some(y=>y.estimatedMonths>0)?'AVAILABLE':'SOURCE_PENDING',cutoff:available.map(p=>p.cutoff).sort().at(-1)??new Date().toISOString().slice(0,7),calculatedAt:new Date().toISOString(),formulaVersion:'consolidated-published-planning/1',sourceFingerprint:reportHash({units:unitIds,proofs:selected.map(p=>p?.sourceFingerprint??null)}),notice:'Consolidado das '+unitIds.length+' unidades selecionadas. Um mês só é somado quando todas possuem a respectiva fonte elegível. Lacunas não são zero. Períodos de faturamento podem diferir; confira o detalhe por unidade. Limites contratuais permanecem separados por unidade.',pending:selected.flatMap((p,i)=>p?.state==='AVAILABLE'?[]:['Planejamento pendente: unidade '+unitIds[i]]),years:result};
}
