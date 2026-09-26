import {demandHistory} from './demand-history';
const doc={organization_id:'o',customer_id:'c',consumer_unit_id:'u',reference_month:'2026-08-01'};
const p=(extra:any={})=>({id:'1',organization_id:'o',customer_id:'c',consumer_unit_id:'u',start_date:'2026-01-01',end_date:'2026-12-31',supersedes_id:null,...extra});
describe('Demand history coverage',()=>{
 it('reports full coverage as reference only',()=>expect(demandHistory([p()],doc)).toMatchObject({state:'COVERED_REFERENCE',canImport:false}));
 it('handles no periods',()=>expect(demandHistory([],doc).state).toBe('MISSING'));
 it('rejects foreign rows',()=>expect(demandHistory([p({organization_id:'other'})],doc).state).toBe('UNAVAILABLE'));
 it('uses correction without old record',()=>expect(demandHistory([p(),p({id:'2',supersedes_id:'1'})],doc).periods.map(x=>x.id)).toEqual(['2']));
 it('reports a midmonth split',()=>expect(demandHistory([p({end_date:'2026-08-15'}),p({id:'2',start_date:'2026-08-16'})],doc).state).toBe('SPLIT'));
 it('detects gap',()=>expect(demandHistory([p({end_date:'2026-08-14'}),p({id:'2',start_date:'2026-08-16'})],doc).state).toBe('GAP'));
 it('does not reuse old month',()=>expect(demandHistory([p({end_date:'2026-07-31'})],doc).state).toBe('MISSING'));
 it('fails closed on missing query',()=>expect(demandHistory(null,doc).state).toBe('UNAVAILABLE'));
});
