import {homologationProgress} from './homologation-progress';
const field=(key:string,state='EXTRACTED_REVIEW',decision='CONFIRMED')=>({key,label:key,state,sourceHash:'current',decimal:'10',history:[{id:'review',sourceHash:'current',decision,author:'Maria',createdAt:'2026-09-27',version:1}]});
const identity=()=>['customer','taxId','unit','address','period','market'].map(k=>field(k));
const consumption=()=>['consumptionPeakKwh','consumptionOffPeakKwh','consumptionTotalKwh'].map(k=>field(k));
const demand=()=>[field('row1','BILLED_UNCLASSIFIED','USED'),field('row2','BILLED_UNCLASSIFIED','UNUSED')];
describe('homologation progress',()=>{
 it('never grants import or financial homologation even with all reviews',()=>{const r=homologationProgress(identity(),consumption(),demand());expect(r.state).toBe('REVIEWS_COMPLETE');expect(r.canImport).toBe(false);expect(r.homologated).toBe(false);expect(r.integration.every(v=>v.state!=='COMPLETE')).toBe(true);expect(r.groups[2].confirmed).toBe(2);});
 it('requires all six identity and three consumption fields',()=>{const r=homologationProgress([],[],[]);expect(r.groups.map(g=>[g.confirmed,g.total,g.complete])).toEqual([[0,6,false],[0,3,false],[0,0,false]]);});
 it('does not count a review after registration or evidence changed',()=>{const a=identity();a[0].sourceHash='new';const r=homologationProgress(a,consumption(),demand());expect(r.groups[0].rows[0].state).toBe('STALE');expect(r.groups[0].confirmed).toBe(5);});
 it('uses the latest correction even if histories arrive out of order',()=>{const a=identity();a[0].history.push({...a[0].history[0],version:2,decision:'NEEDS_CORRECTION'});expect(homologationProgress(a,consumption(),demand()).groups[0].rows[0].state).toBe('NEEDS_CORRECTION');});
 it('blocks duplicate keys and an unavailable current field',()=>{const a=identity();a.push(a[0]);a[1].state='BLOCKED';expect(homologationProgress(a,consumption(),demand()).groups[0].confirmed).toBe(4);});
 it('preserves reviewer evidence and does not substitute demands for consumption',()=>{const r=homologationProgress(identity(),[],demand());expect(r.groups[1].complete).toBe(false);expect(r.groups[2].rows[0].review?.author).toBe('Maria');});
 it('does not count missing, unknown or ambiguous decisions',()=>{const a=identity();a[0].history=[];a[1].history[0].decision='USED';a[2].history.push({...a[2].history[0]});expect(homologationProgress(a,consumption(),demand()).groups[0].confirmed).toBe(3);});
});
