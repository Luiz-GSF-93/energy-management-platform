import {supplierIcmsAmount,supplierIcmsReference,verifySupplierIcms} from './supplier-icms';
const confirmation={parameterId:'p',revision:2,rate:'18',reason:'Usuário confirmou ICMS não embutido na nota Axia.'};
const unit={id:'u',organization_id:'o',customer_id:'c',free_market:true};
const p={id:'p',revision:2,organization_id:'o',customer_id:'c',consumer_unit_id:'u',kind:'TAX',component_code:'ICMS',scenario:'ACL',status:'APPROVED',start_date:'2026-08-01',end_date:'2026-08-31',treatment:'INCLUDED',measure:'PERCENT',direction:'DEBIT',source:'Referência confirmada',amount_text:'18',unit_context:unit};
describe('confirmed supplier ICMS',()=>{
 it('grosses up the original invoice once, rounding to cents',()=>{expect(supplierIcmsAmount('16857.18',confirmation)).toEqual({base:'16857.18',tax:'3700.36',total:'20557.54',rate:'18'});});
 it('does not use simple 18% or mutate the original amount',()=>{const before={...confirmation};expect(supplierIcmsAmount('100.00',confirmation).total).toBe('121.95');expect(confirmation).toEqual(before);});
 it.each(['0','100','-18','abc','18.1234567'])('rejects invalid rate %s',rate=>expect(()=>supplierIcmsAmount('100.00',{...confirmation,rate})).toThrow());
 it('requires explicit source reason',()=>expect(()=>supplierIcmsAmount('100.00',{...confirmation,reason:''})).toThrow());
 it('uses scoped current approved ACL reference',()=>expect(verifySupplierIcms(unit,'2026-08',[p],confirmation).revision).toBe(2));
 it.each(['organization_id','customer_id','consumer_unit_id'])('rejects foreign reference %s',key=>expect(()=>supplierIcmsReference(unit,'2026-08',[{...p,[key]:'other'}])).toThrow());
 it('rejects partial validity',()=>expect(()=>supplierIcmsReference(unit,'2026-08',[{...p,start_date:'2026-08-02'}])).toThrow());
 it('rejects competing draft',()=>expect(()=>supplierIcmsReference(unit,'2026-08',[p,{...p,id:'draft',status:'DRAFT'}])).toThrow());
 it('rejects stale revision and changed rate',()=>{expect(()=>verifySupplierIcms(unit,'2026-08',[{...p,revision:3}],confirmation)).toThrow();expect(()=>verifySupplierIcms(unit,'2026-08',[{...p,amount_text:'19'}],confirmation)).toThrow();});
});
