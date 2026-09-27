import {adjustedContracts,feeAdjustmentCycles,feeNotice} from './fee-adjustment';
import {feeAdjustmentInput,FeeAdjustmentsService} from './fee-adjustments.service';
const id='11111111-1111-4111-8111-111111111111';
const body={effectiveDate:'2028-01-01',indexName:'IPCA',ratePercent:4.5,indexReference:'IPCA acumulado 12 meses / IBGE',noticeDays:30,reason:'Reajuste anual contratual',previousId:null,requestId:id};
describe('annual fee adjustment',()=>{
 it.each([{noticeDays:0},{noticeDays:366},{noticeDays:1.5},{ratePercent:Infinity},{ratePercent:'5'},{ratePercent:-101},{ratePercent:1001},{effectiveDate:'2028-13-01'},{effectiveDate:'2028-01-02'},{created_by:'forged'},{reason:'x'}])('rejects invalid input %p',p=>expect(()=>feeAdjustmentInput({...body,...p})).toThrow());
 it('supports an unpublished index without inventing a zero adjustment',()=>expect(feeAdjustmentInput({...body,ratePercent:null}).ratePercent).toBeNull());
 const contract={id:'c',organization_id:'org',fixed_fee_monthly:100,remuneration_model:'HYBRID',savings_percentage:20};
 const row={id:'a',contract_id:'c',organization_id:'org',kind:'management',version:1,effective_date:'2028-01-01',next_value:105,notice_days:30};
 it('keeps original fee before validity and changes only fixed fee afterward',()=>{expect(adjustedContracts([contract],[row],'2027-12')[0].fixed_fee_monthly).toBe(100);expect(adjustedContracts([contract],[row],'2028-01')[0]).toMatchObject({fixed_fee_monthly:105,savings_percentage:20});});
 it('uses corrected cycle and preserves earlier years',()=>{const rows=[row,{...row,id:'b',version:2,next_value:106},{...row,id:'c',version:3,effective_date:'2029-01-01',next_value:110}];expect(feeAdjustmentCycles(rows)).toHaveLength(2);expect(adjustedContracts([contract],rows,'2028-06')[0].fixed_fee_monthly).toBe(106);});
 it('cannot use another organization adjustment',()=>expect(adjustedContracts([contract],[{...row,organization_id:'other'}],'2028-01')[0].fixed_fee_monthly).toBe(100));
 it('marks unresolved due index as pending',()=>expect(adjustedContracts([contract],[{...row,next_value:null}],'2028-01')[0]).toMatchObject({fee_adjustment_pending:true,fixed_fee_monthly:null}));
 it('respects notice window inclusively',()=>{expect(feeNotice(row,'2027-12-01')).toBe(false);expect(feeNotice(row,'2027-12-02')).toBe(true);expect(feeNotice(row,'2028-01-01')).toBe(true);expect(feeNotice(row,'2028-01-02')).toBe(false);});
 it('rejects a consultation user before touching storage',async()=>{const service=new FeeAdjustmentsService({getClient:()=>{throw Error('storage');}} as any,{} as any);await expect(service.create('management',id,body,{role:'consulta',userId:id} as any)).rejects.toMatchObject({status:403});});
 it('returns no notices to unlinked user and scopes membership on server',async()=>{const q:any={select:jest.fn(()=>q),eq:jest.fn(()=>q),maybeSingle:jest.fn().mockResolvedValue({data:{exclusive_customer_id:null},error:null})};const db={getClient:()=>({from:jest.fn(()=>q)})};const service=new FeeAdjustmentsService(db as any,{requireEntitlement:jest.fn()} as any);expect(await service.notices({organizationId:'org',userId:id} as any)).toEqual({notices:[]});expect(q.eq).toHaveBeenCalledWith('organization_id','org');expect(q.eq).toHaveBeenCalledWith('user_id',id);expect(q.eq).toHaveBeenCalledWith('status','active');});
});
