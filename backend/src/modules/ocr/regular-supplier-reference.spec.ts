import {regularSupplierReference,documentedSupplierSettlement} from './documented-supplier-settlement';
const invoice={quantityMwh:'10',pricePerMwh:'120',baseAmount:'1200.00',source:'Verified regular invoice of the same month'};
const prior=()=>({source:{documentId:'annex',fileHash:'a'.repeat(64)},memory:null,supplier:{contractedMwh:'10',minMwh:'5',maxMwh:'14',pricePerMwh:null,contract:{id:'contract'}}});
describe('Actual regular invoice before index projections',()=>{
 it('preserves evidenced contract volumes without requiring a projected index price',()=>{const p=prior();p.supplier.minMwh='5.000000000000';p.supplier.maxMwh='14.000000000000';const before=JSON.stringify(p);expect(regularSupplierReference(p,invoice)).toMatchObject({minimum:'5.000000000000',maximum:'14.000000000000',price:null,memory:null,source:p.source});expect(JSON.stringify(p)).toBe(before);});
 it('still requires verified matching memory when there is no regular invoice',()=>{const p:any=prior();expect(regularSupplierReference(p)).toBeUndefined();p.memory={pricePerMwh:'120'};p.supplier.pricePerMwh='121';expect(regularSupplierReference(p)).toBeUndefined();p.supplier.pricePerMwh='120';expect(regularSupplierReference(p)?.price).toBe('120');});
 it.each(['source','volume','range'])('does not replace missing contractual evidence: %s',kind=>{const p:any=prior();if(kind==='source')p.source=null;if(kind==='volume')p.supplier.contractedMwh=null;if(kind==='range')p.supplier.minMwh='15';expect(regularSupplierReference(p,invoice)).toBeUndefined();});
});
