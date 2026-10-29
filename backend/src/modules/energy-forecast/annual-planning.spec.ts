import {annualPlanning,planningDifference} from './annual-planning';
const scope={organizationId:'org',customerId:'customer',unitId:'unit'},at='2026-10-29T12:00:00Z';
const observation=(month:string,kwh='300',days=30)=>({month,consumptionKwh:kwh,billedDays:days,evidence:{...scope,id:month,revision:1,hash:'a'.repeat(64),validatedBy:'review',validatedAt:at}});
const publication=(month:string,kwh='600',days=30)=>({...scope,month,publicationId:month,sourceHash:'b'.repeat(64),publishedAt:at,fields:[{key:'consumptionTotal',value:kwh},{key:'consumptionPeak',value:'0'},{key:'consumptionOffPeak',value:kwh}],tariffLines:[{component:'TE',billedDays:String(days)},{component:'TE',billedDays:String(days)}]});
const run=(rows:any[],pubs:any[]=[],cutoff='2026-01',expansions:any[]=[])=>annualPlanning(scope,rows,pubs,cutoff,new Map(rows.map(r=>[r.month,'PUBLISHED_INVOICE_HISTORY'])),expansions,at);
const target=(p:ReturnType<typeof run>,year=2026,month='01')=>p.years.find(y=>y.year===year)!.rows.find(r=>r.month===year+'-'+month)!;
it('uses documented days and recency weights with exact decimal rounding, retaining missing months',()=>{
 const plan=run([observation('2025-10'),observation('2025-12','600')]);
 expect(plan.state).toBe('AVAILABLE');expect(target(plan).simulatedKwh).toBe('516.666667');expect(target(plan).historyMonths).toBe(2);expect(plan.years.at(-1)!.rows).toHaveLength(12);expect(target(plan).publishedKwh).toBeNull();
});
it('never uses the target actual or later source to retrospectively predict that same month',()=>{
 const old=[observation('2025-11'),observation('2025-12','600')],a=run(old),b=run([...old,observation('2026-01','99999'),observation('2026-02','999999')]);
 expect(target(a).simulatedKwh).toBe(target(b).simulatedKwh);expect(target(b,2026,'02').historyMonths).toBe(3);expect(b.sourceFingerprint).not.toBe(a.sourceFingerprint);
});
it('keeps published quantities separate and computes year-on-year, simulation and daily differences',()=>{
 const rows=[observation('2025-01','300'),observation('2025-12','600')],plan=run(rows,[publication('2026-01','660')]),r=target(plan);
 expect(r.publishedKwh).toBe('660.000000');expect(r.previousKwh).toBe('300');expect(r.origin).toBe('PUBLISHED_CONSUMPTION');expect(r.difference).toEqual({kwh:'360.000000',percent:'120.000000'});expect(r.dailyDifference.percent).toBe('120.000000');expect(r.versusSimulation.kwh).not.toBeNull();
 expect(plan.years.at(-1)!.comparableMonths).toBe(1);
});
it('uses only paired months for accumulated comparisons',()=>{
 const p=run([observation('2025-01','300'),observation('2025-03','900')],[publication('2026-01','600'),publication('2026-02','100')],'2026-02'),y=p.years.at(-1)!;
 expect(y.comparableMonths).toBe(1);expect(y.comparablePreviousKwh).toBe('300.000000');expect(y.comparableCurrentKwh).toBe('600.000000');expect(y.comparableDifference.percent).toBe('100.000000');
});
it('separates the effect of billed days from an unchanged daily rate',()=>{
 const p=run([observation('2025-02','280',28),observation('2025-12')],[publication('2026-02','300',30)],'2026-02');
 expect(target(p,2026,'02').difference.kwh).toBe('20.000000');expect(target(p,2026,'02').dailyDifference.percent).toBe('0.000000');
});
it('projects a leap-year February with calendar days and a single eligible reference',()=>{
 const p=run([observation('2024-01','310',31)],[],'2024-01'),r=target(p,2024,'02');expect(r.projectedDays).toBe(29);expect(r.simulatedKwh).toBe('290.000000');expect(r.historyMonths).toBe(1);
});
it('caps history at the latest 12 eligible months',()=>{
 const rows=Array.from({length:15},(_,i)=>observation(new Date(Date.UTC(2024,10+i,1)).toISOString().slice(0,7)));
 const r=target(run(rows));expect(r.historyMonths).toBe(12);expect(r.historyFrom).toBe('2025-01');expect(r.historyTo).toBe('2025-12');
});
it('does not manufacture zero observations or percent comparisons with a zero denominator',()=>{
 expect(planningDifference('10','0')).toEqual({kwh:'10.000000',percent:null});expect(planningDifference('0','10')).toEqual({kwh:'-10.000000',percent:'-100.000000'});
 expect(planningDifference(null,'10')).toEqual({kwh:null,percent:null});const p=run([]);expect(p.state).toBe('SOURCE_PENDING');expect(p.years[0].estimatedYearKwh).toBeNull();expect(p.years[0].rows.every(r=>r.simulatedKwh===null)).toBe(true);
});
it('excludes a conflicted publication month without suppressing other verified history',()=>{
 const pub=publication('2026-01');pub.fields[1].value='1';const p=run([observation('2025-12'),observation('2026-01')],[pub]);expect(p.pending).toHaveLength(1);expect(target(p).publishedKwh).toBeNull();expect(target(p).simulatedKwh).toBe('310.000000');
});
it('preserves CCEE precedence through the already filtered publication input',()=>{
 const o=observation('2026-01','700'),p=annualPlanning(scope,[observation('2025-12'),o],[],'2026-01',new Map([[o.month,'CCEE_FINAL']]),[],at);expect(target(p).publishedKwh).toBe('700');expect(target(p).origin).toBe('CCEE_FINAL');
});
it('changes source identity and annual totals on a new publication without mutating observations',()=>{
 const rows=[observation('2025-12')],before=JSON.stringify(rows),a=run(rows),b=run(rows,[publication('2026-01')]);expect(a.sourceFingerprint).not.toBe(b.sourceFingerprint);expect(a.years.at(-1)!.estimatedYearKwh).not.toBe(b.years.at(-1)!.estimatedYearKwh);expect(JSON.stringify(rows)).toBe(before);
});
it.each(['scope','duplicate','days','evidence','publication','duplicatePublication'])('fails closed for invalid %s',kind=>{
 const rows=[observation('2025-12')],pubs=[publication('2026-01')];if(kind==='scope')rows[0].evidence.unitId='foreign';if(kind==='duplicate')rows.push({...rows[0]});if(kind==='days')rows[0].billedDays=0;if(kind==='evidence')rows[0].evidence.hash='bad';if(kind==='publication')pubs[0].customerId='foreign';if(kind==='duplicatePublication')pubs.push({...pubs[0]});expect(()=>run(rows,pubs)).toThrow();
});
it('applies only documented future expansions and rejects a foreign expansion',()=>{
 const e={startMonth:'2026-02',endMonth:'2026-03',monthlyKwh:'100',evidence:{...scope,id:'expansion',revision:1,hash:'e'.repeat(64),recordedBy:'manager',recordedAt:at,justification:'Expansão documentada pelo responsável da unidade.'}},rows=[observation('2025-12')];
 expect(target(run(rows,[],'2026-01',[e]),2026,'02').expansionKwh).toBe('100.000000');e.evidence.unitId='other';expect(()=>run(rows,[],'2026-01',[e])).toThrow('SCOPE');
});

it('retains a verified published total when only billing days are missing, excluding it solely from weighted history',()=>{
 const pub=publication('2026-01','600');pub.tariffLines=[];const p=run([observation('2025-12')],[pub]);expect(target(p).publishedKwh).toBe('600.000000');expect(target(p).currentDailyKwh).toBeNull();expect(target(p,2026,'02').historyMonths).toBe(1);expect(p.pending.join(' ')).toContain('dias pendentes');
});
