import {registeredManagementContracts} from './calculation-autofill.model';

const contract=()=>({id:'registered-fee',organization_id:'org',customer_id:'customer',status:'ACTIVE',start_date:'2026-01-01',end_date:'2027-12-31',remuneration_model:'HYBRID',fixed_fee_monthly:'1031.69',savings_percentage:'9'});
const context=(management:any[]= [contract()])=>({unit:{id:'unit',organization_id:'org',customer_id:'customer'},month:'2026-01',captured:{management,adjustments:[],feeRules:[]}});

describe('EVA honorários do cadastro vigente',()=>{
 it('loads the registered fixed and variable amounts without a monthly allocation',()=>{
  const c=context(),before=JSON.stringify(c),m=registeredManagementContracts(c);
  expect(m).toEqual([expect.objectContaining({fixed_fee_monthly:'1031.69',savings_percentage:'9'})]);
  expect(JSON.stringify(c)).toBe(before);
 });
 it('uses changed registered amounts rather than customer-specific constants',()=>{
  const c=context([{...contract(),fixed_fee_monthly:'725.43',savings_percentage:'7.5'}]);
  expect(registeredManagementContracts(c)[0]).toMatchObject({fixed_fee_monthly:'725.43',savings_percentage:'7.5'});
 });
 it('accepts an indefinite contract and preserves the complete monthly validity boundary',()=>{
  expect(registeredManagementContracts(context([{...contract(),end_date:null}]))).toHaveLength(1);
  expect(registeredManagementContracts(context([{...contract(),end_date:'2026-01-30'}]))).toHaveLength(0);
  expect(registeredManagementContracts(context([{...contract(),start_date:'2026-01-02'}]))).toHaveLength(0);
 });
 it.each([{organization_id:'another-org'},{customer_id:'another-customer'},{status:'CANCELLED'},{start_date:'invalid'},{end_date:'invalid'},{end_date:'2025-12-31'}])('rejects an ineligible register %j',patch=>{
  expect(registeredManagementContracts(context([{...contract(),...patch}]))).toHaveLength(0);
 });
 it('preserves ambiguity instead of picking one overlapping contract',()=>{
  expect(registeredManagementContracts(context([contract(),{...contract(),id:'overlap'}]))).toHaveLength(2);
 });
 it('applies the registered effective adjustment without altering the variable percentage',()=>{
  const c:any=context();c.month='2026-02';c.captured.adjustments=[{id:'adjustment',kind:'management',organization_id:'org',contract_id:'registered-fee',effective_date:'2026-02-01',version:1,next_value:'1080.00'}];
  expect(registeredManagementContracts(c)[0]).toMatchObject({fixed_fee_monthly:'1080.00',savings_percentage:'9',fee_adjustment:{id:'adjustment'}});
  c.month='2026-01';expect(registeredManagementContracts(c)[0].fixed_fee_monthly).toBe('1031.69');
 });
});
