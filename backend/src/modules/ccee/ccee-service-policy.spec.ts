import {semanticCursor,servicePolicyPlan} from './ccee-service-policy.model';
const now=new Date('2026-10-27T15:15:00Z');
const policy={id:'p',kind:'MEASUREMENTS',authorization_id:'b',source_selector:{},month_mode:'FIXED',cursor:{},last_monthly_date:null};
const context=(patch:any={})=>({policy,targetMonth:'2026-09',today:'2026-10-27',agendaReady:false,...patch});
describe('Automatic read policy',()=>{
 it('does not mistake response ordering or key ordering for new data',()=>expect(semanticCursor([{a:1,b:2},{x:3}])).toBe(semanticCursor([{x:3},{b:2,a:1}])));
 it('only enqueues FINAL reads with the reviewed binding',()=>expect(servicePolicyPlan(context(),now)).toMatchObject({action:'enqueue',kind:'MEASUREMENTS',body:{authorizationId:'b',month:'2026-09',measurementKind:'FINAL'}}));
 it('waits for the official agenda for a rolling month',()=>expect(servicePolicyPlan(context({policy:{...policy,month_mode:'PREVIOUS_CLOSED'}}),now).state).toBe('WAITING_FOR_AGENDA'));
 it('limits complete month calls to once a day, but allows a new month',()=>{const p={...policy,last_monthly_date:'2026-10-27',cursor:{month:'2026-09'}};expect(servicePolicyPlan(context({policy:p}),now).action).toBe('finish');expect(servicePolicyPlan(context({policy:p,targetMonth:'2026-10'}),now).action).toBe('enqueue');});
 it('preserves a pending job and stops an expired worker without repeating it',()=>{expect(servicePolicyPlan(context({job:{state:'RUNNING',lease_until:'2026-10-27T15:16:00Z'}}),now)).toMatchObject({keepJob:true});expect(servicePolicyPlan(context({job:{state:'RUNNING',lease_until:'2026-10-27T15:14:00Z'}}),now)).toMatchObject({enabled:false,error:'RESULT_NOT_CONFIRMED'});});
 it('does not retry a functional failure automatically',()=>expect(servicePolicyPlan(context({job:{state:'FAILED',error_code:'PROVIDER_REJECTED'}}),now)).toMatchObject({enabled:false,state:'REVIEW_REQUIRED'}));
 it('waits until the next Brasilia day after a budget stop',()=>expect(servicePolicyPlan(context({job:{state:'FAILED',error_code:'BUDGET_EXHAUSTED'}}),now)).toMatchObject({state:'BUDGET_PAUSED',nextRunAt:'2026-10-28T03:00:00.000Z'}));
 it('records success only with complete rows',()=>{const p={...policy,cursor:{stage:'MEASUREMENTS'}};expect(servicePolicyPlan(context({policy:p,job:{state:'SUCCEEDED',result:{complete:true,data:{rows:[{hourLabel:'2026-09-30T23:00:00-03:00',quantityKwh:'1'}]}}}}),now)).toMatchObject({success:true,sourceMonth:'2026-09'});expect(servicePolicyPlan(context({policy:p,job:{state:'PARTIAL',result:{complete:false}}}),now)).toMatchObject({enabled:false});});
 it('selects DRI from exact catalog names and detects ambiguity',()=>{const p={...policy,kind:'DRI',cursor:{stage:'EVENTS'},source_selector:{eventName:'Contabilização'}};const row={name:'Contabilização',month:'2026-09',code:'77'};const result=(rows:any[])=>servicePolicyPlan(context({policy:p,job:{id:'j',state:'SUCCEEDED',result:{complete:true,data:{rows}}}}),now);expect(result([row])).toMatchObject({kind:'DRI_REPORTS',body:{eventCode:'77',parentJobId:'j'}});expect(result([row,row])).toMatchObject({enabled:false,error:'EVENT_SELECTION_REVIEW'});expect(result([]).state).toBe('WAITING_FOR_SOURCE');});
 it('uses the target competence while preserving the exact accounting event type',()=>{
  const p={...policy,kind:'DRI',month:'2026-03-01',month_mode:'PREVIOUS_CLOSED',cursor:{stage:'EVENTS'},source_selector:{eventName:'2026_03 - CONTABILIZA&#199;&#195;O'}};
  const result=(name:string)=>servicePolicyPlan(context({policy:p,job:{id:'j',state:'SUCCEEDED',result:{complete:true,data:{rows:[{code:'202609001000',name,month:'2026-09'}]}}}}),now);
  expect(result('2026_09 - CONTABILIZAÇÃO')).toMatchObject({kind:'DRI_REPORTS',body:{eventCode:'202609001000',month:'2026-09'}});
  for(const name of ['2026_03 - CONTABILIZAÇÃO','2026_09 - RECONTABILIZAÇÃO','2026_09 - 1ª REAPURAÇÃO'])expect(result(name).state).toBe('WAITING_FOR_SOURCE');
 });
 it('does not repeat downstream reads solely because the same event occurred twice in the provider list',()=>{
  const row={name:'Contabilização',month:'2026-09',code:'77',sourceIdentity:'same-full-source'},eventsHash=semanticCursor([row]),p={...policy,kind:'DRI',cursor:{stage:'EVENTS',month:'2026-09',eventsHash},source_selector:{eventName:'Contabilização'}};
  expect(servicePolicyPlan(context({policy:p,job:{id:'j',state:'SUCCEEDED',result:{complete:true,data:{rows:[{...row,providerOccurrences:2}]}}}}),now)).toMatchObject({action:'finish',state:'READY'});
 });

});
