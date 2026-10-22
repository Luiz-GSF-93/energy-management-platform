import {contractSupplierCost} from '../contracts/services/contract-supplier-cost';
import {structuredSpotMonth} from './monthly-supplier-mode';
import {contractClosingDraftApplicable,contractClosingDraft} from './contract-closing-draft';
import {SourcePreparationService} from './source-preparation.service';

function fixture(){
 const scope={organization_id:'org',customer_id:'customer',consumer_unit_id:'unit'};
 const unit={...scope,id:'unit',free_market:true};
 const contract={...scope,id:'contract',contract_number:'SYNTHETIC-SPOT',contract_type:'ENERGY_PURCHASE',status:'ACTIVE',start_date:'2026-01-01',end_date:'2026-12-31',contracted_volume_mwh:'105.07',pricing_mode:'FIXED',current_price:'245.38'};
 const rule={...scope,id:'rule',contract_id:'contract',version:2,source:'Nota sintética da compra mensal',start_date:'2026-04-01',end_date:'2026-04-30',volume_basis:'SPOT',price_mode:'FINAL',tax_treatment:'GROSS',min_percent:null,max_tolerance_percent:null,index_percent:null};
 const c:any={unit,month:'2026-04',captured:{contracts:[contract],billingRules:[rule]},sourcePreparation:{documents:[{link:'REGISTERED_CONTRACT_DOCUMENT',annex:{state:'PROPOSED',index:'IPCA/IBGE',price:'118.00'}}]}};
 const refresh=()=>c.diagnosis={contractSupplierCost:contractSupplierCost(unit,c.month,c.captured.contracts,[],c.captured.billingRules,[],[],new Date('2026-10-22T12:00:00Z'))};
 refresh();return {c,contract,rule,refresh};
}
describe('monthly spot purchasing takes precedence over an older regular annex',()=>{
 it('preserves the existing supplier engine and never applies the old indexed annex to an identified spot month',()=>{
  const {c}=fixture(),before=JSON.stringify(c);
  expect(c.diagnosis.contractSupplierCost).toMatchObject({formulaVersion:'spot-supplier-1.0',pricePerMwh:'245.380000000000',maxMwh:null,minMwh:null});
  expect(structuredSpotMonth(c)).toBe(true);
  expect(contractClosingDraftApplicable(c)).toBe(false);
  expect(contractClosingDraft(c,[])).toMatchObject({state:'PENDING',supplier:null,financialApproval:false,canPublish:false,requirements:[{code:'SPOT_MONTH',section:'supply',message:expect.any(String)}]});
  expect(JSON.stringify(c)).toBe(before);
 });
 it('does not download/reinterpret the regular contract or approve a spot invoice',async()=>{
  const old=process.env.EVA_SOURCE_PREPARATION_V3_ENABLED;process.env.EVA_SOURCE_PREPARATION_V3_ENABLED='true';
  try{const {c}=fixture(),getClient=jest.fn();const r=await new SourcePreparationService({getClient} as any).inspect(c);
   expect(getClient).not.toHaveBeenCalled();expect(r).toMatchObject({documents:[],automaticFinancialApproval:false});expect(r?.observations.join(' ')).toContain('conciliada');
  }finally{if(old===undefined)delete process.env.EVA_SOURCE_PREPARATION_V3_ENABLED;else process.env.EVA_SOURCE_PREPARATION_V3_ENABLED=old;}
 });
 it.each(['foreign unit','foreign customer','foreign organization','partial month','duplicate version','newer rule','wrong result','missing source','old month','minimum','indexed spot','overlapping contract'])('does not infer monthly spot coverage from %s',kind=>{
  const {c,rule}=fixture();
  if(kind==='foreign unit')rule.consumer_unit_id='other';if(kind==='foreign customer')rule.customer_id='other';if(kind==='foreign organization')rule.organization_id='other';
  if(kind==='partial month')rule.start_date='2026-04-02';if(kind==='duplicate version')c.captured.billingRules.push({...rule,id:'duplicate'});
  if(kind==='newer rule')c.captured.billingRules.push({...rule,id:'newer',version:3,volume_basis:'MONTHLY'});
  if(kind==='wrong result')c.diagnosis.contractSupplierCost.rule.id='other';if(kind==='missing source')rule.source=' ';
  if(kind==='old month')c.diagnosis.contractSupplierCost.month='2026-03';if(kind==='minimum')rule.min_percent='50' as any;
  if(kind==='indexed spot')rule.price_mode='BASE_PLUS_INDEX';if(kind==='overlapping contract')c.captured.contracts.push({...c.captured.contracts[0],id:'overlap'});
  expect(structuredSpotMonth(c)).toBe(false);
 });
 it('keeps regular indexed preparation available in the preceding month',()=>{
  const {c,rule,refresh}=fixture();c.month='2026-03';Object.assign(rule,{start_date:'2026-03-01',end_date:'2026-03-31',volume_basis:'MONTHLY',min_percent:'50',max_tolerance_percent:'40'});refresh();
  expect(structuredSpotMonth(c)).toBe(false);expect(contractClosingDraftApplicable(c)).toBe(true);
 });
});
