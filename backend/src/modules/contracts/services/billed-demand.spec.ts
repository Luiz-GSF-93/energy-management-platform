import {billedDemandIssues,normalizeBilledDemand} from './billed-demand';
const green={tariff_group:'A',tariff_modality:'GREEN'},blue={...green,tariff_modality:'BLUE'};
describe('reviewed billing inputs',()=>{
 it('leaves legacy measurements without billing assumptions',()=>{expect(normalizeBilledDemand(null)).toBeNull();expect(billedDemandIssues(null,green,true)).toEqual([]);});
 it('normalizes exact optional fields',()=>expect(normalizeBilledDemand({ACL:{single:'0',source:' fatura '}})).toEqual({ACL:{single:'0',peak:null,offPeak:null,source:'fatura'}}));
 it('permits incomplete draft but not validation',()=>{const d={ACL:{source:'fatura',peak:'1'}};expect(billedDemandIssues(d,blue)).toEqual([]);expect(billedDemandIssues(d,blue,true).length).toBeGreaterThan(0);});
 it.each([green,blue])('does not mix bands %s',c=>expect(billedDemandIssues({ACL:{single:'1',peak:'2',source:'F'}},c).length).toBeGreaterThan(0));
 it.each([[],1,{OTHER:{}},{ACL:[]},{ACL:{source:'',single:'1'}},{ACL:{source:'F',single:'1e2'}},{ACL:{source:'F',single:1}},{ACL:{source:'F',x:'1'}}])('rejects malformed structure %s',d=>expect(billedDemandIssues(d,green,true).length).toBeGreaterThan(0));
 it('requires compatible modality on validation',()=>{expect(billedDemandIssues({ACL:{source:'F',single:'1'}},blue,true).length).toBeGreaterThan(0);expect(billedDemandIssues({ACL:{source:'F',peak:'1',offPeak:'2'}},green,true).length).toBeGreaterThan(0);expect(billedDemandIssues({ACL:{source:'F',single:'1'}},{tariff_group:'B',tariff_modality:'CONVENTIONAL'},true).length).toBeGreaterThan(0);});
});
