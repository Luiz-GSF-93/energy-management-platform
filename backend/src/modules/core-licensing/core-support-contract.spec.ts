import {coreLicenseInput,CORE_LICENSE_MODULES} from './core-license-contract';
const id='11111111-1111-4111-8111-111111111111';
const now=new Date().toISOString();
const body={eventId:id,coreSubscriptionId:id,revision:1,source:'manual',customer:{legalName:'Empresa sintética',cnpj:'16640933000183',adminName:'Administrador de teste',email:'admin@example.test'},plan:{id,version:1,name:'Plano de teste',description:'Homologação',modules:Object.fromEntries(CORE_LICENSE_MODULES.map(k=>[k,k==='document_management'])),limits:{clients:1,users:2,units:2,documents:100},aiMonthlyMicroUsd:0,monthlyCents:10000},contract:{offerId:id,contentHash:'a'.repeat(64),signedPdfHash:'b'.repeat(64),verifiedAt:now,environment:'production'},payment:{id:'pay_test',subscriptionId:'sub_test',customerId:'cus_test',status:'RECEIVED',billingType:'CREDIT_CARD',amountCents:10000,cycle:'MONTHLY',verifiedAt:now},billing:{paidThrough:'2026-12-01',oldestUnpaidDueOn:null,cancelled:false}};
describe('Signed plan support entitlement boundary',()=>{
 test('legacy commands keep their original shape and limits',()=>{expect(coreLicenseInput(body)).toBe(body);expect(body.plan).not.toHaveProperty('support');});
 test('signed annual allowance and exact additional price are accepted',()=>{const next={...body,plan:{...body.plan,support:{enabled:true,annual_tickets:5,extra_ticket_cents:2500}}};expect(coreLicenseInput(next).plan.support.annual_tickets).toBe(5);});
 test('invalid values and undeclared entitlement fields are rejected',()=>{
  for(const s of [{enabled:true,annual_tickets:-1,extra_ticket_cents:0},{enabled:true,annual_tickets:1.5,extra_ticket_cents:0},{enabled:false,annual_tickets:5,extra_ticket_cents:0},{enabled:true,annual_tickets:5,extra_ticket_cents:0,unlimited:true}])expect(()=>coreLicenseInput({...body,plan:{...body.plan,support:s}})).toThrow();
 });
});
