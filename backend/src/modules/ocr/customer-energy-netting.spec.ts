import {customerEnergyNetting,applyEnergyNettingToDraft} from './customer-energy-netting';
function fixture(){return ['u1','u2'].map((id,index)=>{
 const p={documentId:'nf-'+id,fileHash:(index?'b':'a').repeat(64),month:'2026-01',quantityMwh:index?'1.0':'2.0'};
 const allocation={documentId:p.documentId,fileHash:p.fileHash,actor:'operator',customerNetting:{customerId:'customer',reason:'Operator explicitly confirms documented customer energy netting this month.'}};
 const draft={format:'supplier-invoice-evidence-1',requirements:[{code:'SUPPLIER_ENERGY_COVERAGE'},{code:'CCEE_COVERAGE'}],differences:[],supplier:{totalAmount:'123.45'},source:{documentId:p.documentId,fileHash:p.fileHash,allocation},energyCoverage:{consumptionMwh:'1.0',lossMwh:'0.2',requiredMwh:'1.2',creditMwh:'0.1',availableMwh:index?'1.1':'2.1',invoiceSource:{documentId:p.documentId,fileHash:p.fileHash}}};
 return {unitId:id,context:{month:'2026-01',unit:{id,organization_id:'org',customer_id:'customer'},supplierInvoiceProposal:p,manualAuthor:'operator',manualOverrides:{supplierInvoiceAllocation:allocation}},plan:{contractDraft:draft}};
 });}
describe('Explicit consolidated energy netting',()=>{
 it('combines documented energy only, preserving every fiscal quantity and every other requirement',()=>{
 const e=fixture(),before=JSON.stringify(e),r=customerEnergyNetting(e,'org','customer','2026-01','CUSTOMER');expect(r.accepted).toBe(true);expect(r.proof).toMatchObject({requiredMwh:'2.400000000000',availableMwh:'3.200000000000',surplusMwh:'0.800000000000',financialApproval:false});
 const d=applyEnergyNettingToDraft(e[1].plan.contractDraft,r.proof);expect(d.requirements).toEqual([{code:'CCEE_COVERAGE'}]);expect(d.supplier.totalAmount).toBe('123.45');expect(JSON.stringify(e)).toBe(before);expect(d.energyCoverage.state).toBe('CUSTOMER_NETTED');
 });
 it.each(['unit-scope','duplicate','customer','organization','month','author','hash','loss','insufficient','missing-ack'])('does not net incomplete or foreign evidence: %s',kind=>{
 const e:any=fixture();let scope='CUSTOMER';if(kind==='unit-scope')scope='UNIT';if(kind==='duplicate')e[1].unitId=e[0].unitId;if(kind==='customer')e[1].context.unit.customer_id='foreign';if(kind==='organization')e[1].context.unit.organization_id='foreign';if(kind==='month')e[1].context.month='2026-02';if(kind==='author')e[1].context.manualAuthor='different';if(kind==='hash')e[1].plan.contractDraft.source.fileHash='c'.repeat(64);if(kind==='loss')e[1].plan.contractDraft.energyCoverage.requiredMwh='-1';if(kind==='insufficient'){e[0].context.supplierInvoiceProposal.quantityMwh='0.5';e[0].plan.contractDraft.energyCoverage.availableMwh='0.6';}if(kind==='missing-ack')delete e[1].plan.contractDraft.source.allocation.customerNetting;
 expect(customerEnergyNetting(e,'org','customer','2026-01',scope).accepted).toBe(false);
 });
});
