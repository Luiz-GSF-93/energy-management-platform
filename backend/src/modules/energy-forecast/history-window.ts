import {monthIndex,type Observation} from './consumption-forecast';

/** Sources are authorized and conflict-checked before choosing a calculation window. */
export function selectForecastHistoryWindow(observations:Observation[],cutoff:string){
 const end=monthIndex(cutoff);
 const ordered=[...observations].sort((a,b)=>monthIndex(a.month)-monthIndex(b.month));
 if(ordered.length<12||monthIndex(ordered[ordered.length-1].month)!==end)throw Error('HISTORY_WINDOW_INCOMPLETE');
 ordered.forEach((row,i)=>{
  if(monthIndex(row.month)>end||(i>0&&monthIndex(row.month)!==monthIndex(ordered[i-1].month)+1))throw Error('HISTORY_WINDOW_GAP_DUPLICATE_OR_FUTURE');
 });
 const selected=ordered.slice(-36),excluded=ordered.slice(0,-selected.length);
 return {observations:selected,historyWindow:{version:'forecast-history-window/1.0',strategy:'LATEST_UP_TO_36' as const,availableMonths:ordered.length,selectedMonths:selected.length,from:selected[0].month,to:cutoff,excludedMonths:excluded.map(row=>row.month)}};
}
