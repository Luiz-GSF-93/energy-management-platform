import {reviewedDemandSummary} from './reviewed-demand-summary';
const field=(key='one',decimal='234.6400',decision='USED'):any=>({key,source:key,label:key,sourceHash:'current',state:'BILLED_UNCLASSIFIED',unit:'kW',decimal,history:[{id:key,sourceHash:'current',decision,author:'Gestor',createdAt:'2026-09-27',version:1}]});
describe('reviewed demand summary',()=>{
 it('sums only complete current decisions with exact decimal arithmetic',()=>{const s=reviewedDemandSummary([field(),field('two','265.3600','UNUSED')]);expect(s).toMatchObject({state:'COMPLETE',usedKw:'234.6400',unusedKw:'265.3600',canImport:false,reviewed:2});});
 it('preserves small quantities exactly',()=>{expect(reviewedDemandSummary([field('a','0.000000001'),field('b','0.000000002')]).usedKw).toBe('0.000000003');});
 it('zero means no classified parcel in that category only after completion',()=>{expect(reviewedDemandSummary([field()]).unusedKw).toBe('0.0000');expect(reviewedDemandSummary([])).toMatchObject({state:'EMPTY',unusedKw:null});});
 it.each(['PENDING','NEEDS_CORRECTION','STALE','CONFLICT'])('does not publish partial totals: %s',state=>{const f=field();if(state==='PENDING')f.history=[];if(state==='NEEDS_CORRECTION')f.history[0].decision=state;if(state==='STALE')f.history[0].sourceHash='old';if(state==='CONFLICT')f.state='CONFLICT';expect(reviewedDemandSummary([f,field('two')])).toMatchObject({state:'PENDING',usedKw:null,unusedKw:null});});
 it('never falls back to an older confirmation',()=>{const f=field();f.history.unshift({...f.history[0],decision:'NEEDS_CORRECTION',version:2});expect(reviewedDemandSummary([f]).rows[0].state).toBe('NEEDS_CORRECTION');});
 it('ignores superseded-source decision',()=>{const f=field();f.history.unshift({...f.history[0],sourceHash:'old',version:2});expect(reviewedDemandSummary([f]).rows[0].state).toBe('STALE');});
 it.each(['-1','1e3','NaN','1.0000000001',null])('rejects invalid quantity %s',decimal=>expect(reviewedDemandSummary([field('one',decimal as any)]).rows[0].state).toBe('CONFLICT'));
 it('blocks duplicate source',()=>{const f=field('two');f.source='one';expect(reviewedDemandSummary([field(),f]).state).toBe('PENDING');});
 it('keeps author and version',()=>expect(reviewedDemandSummary([field()]).rows[0].review).toMatchObject({author:'Gestor',version:1}));
 it('never turns unknown decisions into approval',()=>expect(reviewedDemandSummary([field('one','1','APPROVED')]).state).toBe('PENDING'));
});
