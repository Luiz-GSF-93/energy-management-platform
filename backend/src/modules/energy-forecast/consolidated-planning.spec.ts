import {consolidatedPlanning as sum} from './consolidated-planning';
const plan=(unitId:string,n:string)=>({unitId,annualComparison:{state:'AVAILABLE',cutoff:'2026-04',sourceFingerprint:unitId,years:[{year:2026,rows:[{month:'2026-01',previousKwh:'100',simulatedKwh:'110',publishedKwh:n,expansionKwh:'0',currentDailyKwh:'4',previousDailyKwh:'3',historyMonths:12}]}]}});
describe('consolidated selected-unit planning',()=>{
 it('sums the actual series and recomputes percentages, never averages unit percentages',()=>{const r=sum([plan('a','50'),plan('b','150')],['a','b'])!;expect(r.state).toBe('AVAILABLE');expect(r.years[0].rows[0]).toMatchObject({publishedKwh:'200.000000',previousKwh:'200.000000',simulatedKwh:'220.000000',difference:{kwh:'0.000000',percent:'0.000000'}});expect(r.years[0].estimatedMonths).toBe(1);});
 it('does not treat a missing unit or month as zero',()=>{const r=sum([plan('a','50')],['a','b'])!;expect(r.state).toBe('SOURCE_PENDING');expect(r.years[0].rows[0].publishedKwh).toBeNull();expect(r.pending).toHaveLength(1);expect(r.years[0].rows[1].publishedKwh).toBeNull();});
 it('ignores unselected units and keeps their source fingerprints out of output',()=>{const r=sum([plan('a','50'),plan('b','150'),plan('private-other','999')],['a','b'])!;expect(JSON.stringify(r)).not.toContain('private-other');expect(r.years[0].estimatedYearKwh).toBe('200.000000');});
 it('does not duplicate a single-unit forecast as a consolidated forecast',()=>expect(sum([plan('a','50')],['a'])).toBeNull());
});
