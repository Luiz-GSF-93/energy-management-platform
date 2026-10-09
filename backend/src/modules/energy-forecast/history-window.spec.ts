import {selectForecastHistoryWindow as select} from './history-window';
import {calculateConsumptionForecast,type Observation} from './consumption-forecast';
const scope={organizationId:'test-org',customerId:'test-customer',unitId:'test-unit'};
const rows=(length:number):Observation[]=>Array.from({length},(_,i)=>({month:new Date(Date.UTC(2026,8-length+i,1)).toISOString().slice(0,7),consumptionKwh:'3000',billedDays:30,evidence:{...scope,id:'test-evidence',revision:1,hash:'a'.repeat(64),validatedBy:'reviewer',validatedAt:'2026-09-01T00:00:00Z'}}));
describe('auditable forecast history window',()=>{
 it('uses the latest 36 of 44 months without changing the full series',()=>{const source=rows(44),before=JSON.stringify(source),result=select(source,'2026-08');expect(result.observations).toHaveLength(36);expect(result.historyWindow).toEqual({version:'forecast-history-window/1.0',strategy:'LATEST_UP_TO_36',availableMonths:44,selectedMonths:36,from:'2023-09',to:'2026-08',excludedMonths:source.slice(0,8).map(r=>r.month)});expect(JSON.stringify(source)).toBe(before);});
 it.each([12,18,30,32,36])('preserves existing %i month forecasts',length=>{const source=rows(length),selected=select(source,'2026-08');expect(selected.observations).toEqual(source);expect(selected.historyWindow.excludedMonths).toEqual([]);expect(calculateConsumptionForecast({...scope,asOfMonth:'2026-08',observations:selected.observations,expansions:[]})).toEqual(calculateConsumptionForecast({...scope,asOfMonth:'2026-08',observations:source,expansions:[]}));});
 it('keeps minimum history protection',()=>{expect(()=>select(rows(11),'2026-08')).toThrow('INCOMPLETE');expect(()=>select([],'2026-08')).toThrow('INCOMPLETE');});
 it('does not hide a gap in the excluded history',()=>{const source=rows(44);source.splice(2,1);expect(()=>select(source,'2026-08')).toThrow('GAP');});
 it('rejects duplicates and future months before selecting',()=>{const source=rows(44);expect(()=>select([...source,source[0]],'2026-08')).toThrow('DUPLICATE');expect(()=>select(source,'2026-07')).toThrow('INCOMPLETE');});
 it('requires the series to reach the requested cutoff',()=>{expect(()=>select(rows(32).slice(0,-1),'2026-08')).toThrow('INCOMPLETE');});
});
