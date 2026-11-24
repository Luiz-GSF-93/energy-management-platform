import {registeredClosingSources} from './registered-closing-sources';
import {assistedClosingReport} from './eva-assisted-closing.model';

const unit={id:'unit',organization_id:'org',customer_id:'customer',name:'Unit',status:'ACTIVE'};
const contract={id:'fee',organization_id:'org',customer_id:'customer',status:'ACTIVE',start_date:'2023-06-01',end_date:'2027-12-31',fixed_fee_monthly:985,savings_percentage:8,remuneration_model:'HYBRID'};
const sources=(rows:any[]=[contract],adjustments:any[]=[])=>({financial:{tables:{management_contracts:rows,commercial_fee_adjustments:adjustments}},libraries:[]});
describe('independent registered closing sources',()=>{
 it('keeps known fees visible without fabricating missing invoice or financial results',()=>{
  const before=process.env.EVA_SOURCE_PREPARATION_V3_ENABLED;process.env.EVA_SOURCE_PREPARATION_V3_ENABLED='true';
  try{
   const plan=registeredClosingSources(unit,'2025-06',sources());
   const report=assistedClosingReport('org','customer','2025-06',[{unitId:unit.id,name:unit.name,plan,unavailable:'Fatura verificada ausente em junho/2025.'}]);
   expect(report.units[0]).toMatchObject({fixedFee:'985.00',feePercentage:'8',documentId:null,acr:null,aclBeforeFees:null});
   expect(report.missing).toEqual(['Unit: Fatura verificada ausente em junho/2025.']);
   expect(report.approvalEligible).toBe(false);expect(report.financial.status).toBe('INCOMPLETE');
  }finally{if(before===undefined)delete process.env.EVA_SOURCE_PREPARATION_V3_ENABLED;else process.env.EVA_SOURCE_PREPARATION_V3_ENABLED=before;}
 });
 it.each([{organization_id:'other'},{customer_id:'other'},{status:'INACTIVE'},{start_date:'2025-06-02'},{end_date:'2025-05-31'},{end_date:'2025-06-29'},{fixed_fee_monthly:-1},{fixed_fee_monthly:null}])('does not use an ineligible or invalid fixed fee: %j',patch=>{
  expect(registeredClosingSources(unit,'2025-06',sources([{...contract,...patch}])).fields.some(f=>f.key==='fee:fixed')).toBe(false);
 });
 it('does not choose between two current management contracts',()=>{
  expect(registeredClosingSources(unit,'2025-06',sources([contract,{...contract,id:'other'}])).fields).toEqual([]);
 });
 it('applies the registered annual adjustment without depending on a monthly invoice',()=>{
  const adjustment={id:'adjustment',organization_id:'org',contract_id:'fee',kind:'management',effective_date:'2025-06-01',version:1,next_value:'1031.69'};
  expect(registeredClosingSources(unit,'2025-06',sources([contract],[adjustment])).operational.fixedFee).toEqual({amount:'1031.69',source:'Contrato de gestão fee · reajuste adjustment'});
  expect(registeredClosingSources(unit,'2025-05',sources([contract],[adjustment])).operational.fixedFee.amount).toBe('985.00');
  expect(registeredClosingSources(unit,'2025-06',sources([contract],[{...adjustment,next_value:null}])).operational.fixedFee).toBe(null);
 });
});
