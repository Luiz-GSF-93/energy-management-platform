import {EvaManualPreparationQueue} from './eva-manual-preparation.queue';
import {EvaManualPreparationWorker} from './eva-manual-preparation.worker';
import {EvaAssistedClosingController} from './eva-assisted-closing.controller';
import {ServiceUnavailableException} from '@nestjs/common';
const id='00000000-0000-4000-8000-000000000100',unit='00000000-0000-4000-8000-000000000001';
describe('manual preparation gateway and private worker',()=>{
 afterEach(()=>{jest.useRealTimers();jest.restoreAllMocks();});
 const config={get:(k:string)=>k==='EVA_MANUAL_PREPARATION_ASYNC_ENABLED'?'true':undefined} as any;
 const tenant:any={scope:'organization',organizationId:'org',userId:'actor',roleId:'role',role:'operacional',permissions:[]};
 function fixture(){
  const job={id,organizationId:'org',customerId:'customer',consumerUnitId:unit,month:'2026-08',scopeKind:'UNIT',executionId:id};
  const rpc=jest.fn(async(_name:string,args:any):Promise<any>=>args.p_action==='claim'?{data:{id,token:'lease'}}:args.p_action==='context'?{data:{job,delegate:{userId:'actor',roleId:'role',role:'operacional',permissions:[]}}}:args.p_action==='begin'?{data:{accepted:true}}:{data:{alive:true}});
  const db={getClient:()=>({rpc})},queue=new EvaManualPreparationQueue(db as any,config),closing={prepare:jest.fn(async()=>({row:{id:'closing',organization_id:'org',customer_id:'customer',month:'2026-08',report:{unitIds:[unit]}}}))};
  return {rpc,db,queue,closing,job,worker:new EvaManualPreparationWorker(db as any,queue,closing as any)};
 }
 it('persists an intent without invoking the heavy preparation service from the API',async()=>{
  const f=fixture();f.rpc.mockResolvedValue({data:{job:{id,state:'QUEUED'}}});const service={prepare:jest.fn()},controller=new EvaAssistedClosingController(service as any,undefined,undefined,f.queue);
  const body={consumerUnitId:unit,month:'2026-08',scopeKind:'UNIT',requestId:id};expect((await controller.requestPreparation(body,tenant)).job.state).toBe('QUEUED');expect(service.prepare).not.toHaveBeenCalled();expect(f.rpc).toHaveBeenCalledWith('eva_manual_preparation_action_context',expect.objectContaining({p_org:'org',p_platform:false,p_actor:'actor',p_action:'request',p_id:id}));
  expect(()=>controller.prepare(body,tenant)).toThrow('segundo plano');expect(service.prepare).not.toHaveBeenCalled();
 });
 it('preserves legacy preparation only when the async rollout is disabled',async()=>{
  const service={prepare:jest.fn(async()=>({row:{id}}))},queue=new EvaManualPreparationQueue({} as any,{get:()=>undefined} as any),controller=new EvaAssistedClosingController(service as any,undefined,undefined,queue);
  await controller.prepare({},tenant);expect(service.prepare).toHaveBeenCalledTimes(1);expect(queue.availableFor({...tenant,accessMode:'platform_operation'})).toBe(false);
 });
 it('routes an explicit Owner operation through the durable queue, never the synchronous preparation',async()=>{
  const f=fixture();f.rpc.mockResolvedValue({data:{job:{id,state:'QUEUED'}}});const service={prepare:jest.fn()},controller=new EvaAssistedClosingController(service as any,undefined,undefined,f.queue);
  const owner={...tenant,role:'admin_org',accessMode:'platform_operation' as const};
  expect(f.queue.availableFor(owner)).toBe(true);
  await controller.requestPreparation({consumerUnitId:unit,month:'2026-08',scopeKind:'UNIT',requestId:id},owner);
  expect(f.rpc).toHaveBeenCalledWith('eva_manual_preparation_action_context',expect.objectContaining({p_platform:true,p_org:'org',p_actor:'actor'}));
  expect(()=>controller.prepare({},owner)).toThrow('segundo plano');expect(service.prepare).not.toHaveBeenCalled();
  expect(f.queue.availableFor({...owner,role:'gestor'})).toBe(false);expect(f.queue.availableFor({...owner,accessMode:'unrecognized' as any})).toBe(false);
 });
 it('rejects tenant overrides and external callers before database access',async()=>{
  const f=fixture();await expect(f.queue.request({consumerUnitId:unit,month:'2026-08',requestId:id,organizationId:'foreign'},tenant)).rejects.toThrow();await expect(f.queue.status({consumerUnitId:unit,month:'2026-08'},{...tenant,portalCustomerScope:{}})).rejects.toThrow();expect(f.rpc).not.toHaveBeenCalled();
 });
 it('keeps status available while draining and refuses new requests',async()=>{
  const f=fixture(),queue=new EvaManualPreparationQueue(f.db as any,{get:(k:string)=>k==='EVA_MANUAL_PREPARATION_ACCEPTING'?'false':'true'} as any);f.rpc.mockResolvedValue({data:{job:null}});
  await expect(queue.request({consumerUnitId:unit,month:'2026-08',requestId:id},tenant)).rejects.toThrow('pausadas');expect((await queue.status({consumerUnitId:unit,month:'2026-08'},tenant)).accepting).toBe(false);
 });
 it('does not hide denied access when obtaining history metadata',async()=>{
  const f=fixture();f.rpc.mockResolvedValue({error:{code:'42501'}});await expect(f.queue.forHistory({consumerUnitId:unit,month:'2026-08'},tenant)).rejects.toMatchObject({status:403});f.rpc.mockResolvedValue({error:{code:'PGRST002'}});expect(await f.queue.forHistory({consumerUnitId:unit,month:'2026-08'},tenant)).toMatchObject({enabled:true,available:false});
 });
 it('executes the existing financial preparation once with the current delegated requester',async()=>{
  const f=fixture();await f.worker.runOnce();expect(f.closing.prepare).toHaveBeenCalledTimes(1);expect(f.closing.prepare).toHaveBeenCalledWith({consumerUnitId:unit,month:'2026-08',scopeKind:'UNIT',requestId:id},expect.objectContaining({organizationId:'org',userId:'actor',role:'operacional'}));expect(f.rpc).toHaveBeenCalledWith('eva_manual_preparation_worker',expect.objectContaining({p_action:'finish',p_body:{state:'SUCCEEDED',closingId:'closing'}}));
 });
 it('preserves the server-revalidated Owner delegate in the existing worker',async()=>{
  const f=fixture(),previous=f.rpc.getMockImplementation()!;f.rpc.mockImplementation(async(n,a)=>a.p_action==='context'?{data:{job:f.job,delegate:{userId:'owner',roleId:'admin',role:'admin_org',permissions:[],accessMode:'platform_operation'}}}:previous(n,a));
  await f.worker.runOnce();expect(f.closing.prepare).toHaveBeenCalledTimes(1);expect(f.closing.prepare).toHaveBeenCalledWith(expect.objectContaining({requestId:id}),expect.objectContaining({userId:'owner',accessMode:'platform_operation',organizationId:'org'}));
 });
 it('defers a shared execution slot without invoking writes or an OCR provider',async()=>{
  const f=fixture(),previous=f.rpc.getMockImplementation()!;f.rpc.mockImplementation(async(n,a)=>a.p_action==='begin'?{data:{deferred:true}}:previous(n,a));await f.worker.runOnce();expect(f.closing.prepare).not.toHaveBeenCalled();expect(f.rpc).toHaveBeenCalledWith('eva_manual_preparation_worker',expect.objectContaining({p_action:'defer'}));expect(f.rpc.mock.calls.every(([,a])=>a.p_action!=='finish')).toBe(true);
 });
 it('fails before the write boundary if permissions were revoked',async()=>{
  const f=fixture(),previous=f.rpc.getMockImplementation()!;f.rpc.mockImplementation(async(n,a)=>a.p_action==='context'?{error:{code:'42501'}}:previous(n,a));await f.worker.runOnce();expect(f.closing.prepare).not.toHaveBeenCalled();expect(f.rpc).toHaveBeenCalledWith('eva_manual_preparation_worker',expect.objectContaining({p_action:'finish',p_body:expect.objectContaining({state:'FAILED'})}));
 });
 it('does not repeat preparation after an uncertain write',async()=>{
  const f=fixture();f.closing.prepare.mockRejectedValueOnce(Error('private raw failure'));await f.worker.runOnce();expect(f.closing.prepare).toHaveBeenCalledTimes(1);expect(f.rpc).toHaveBeenCalledWith('eva_manual_preparation_worker',expect.objectContaining({p_action:'finish',p_body:{state:'UNKNOWN',code:'PREPARATION_RECONCILIATION_REQUIRED'}}));expect(JSON.stringify(f.rpc.mock.calls)).not.toContain('private raw failure');
 });
 it.each(['capture','reserve','finish'])('records a fixed %s timeout without leaking details or replaying work',async stage=>{
  const f=fixture();f.closing.prepare.mockRejectedValueOnce(new ServiceUnavailableException({code:'EVA_CLOSING_SOURCE_TIMEOUT',stage,details:'PRIVATE_DOCUMENT_AND_KEY'}));
  await f.worker.runOnce();expect(f.closing.prepare).toHaveBeenCalledTimes(1);
  expect(f.rpc).toHaveBeenCalledWith('eva_manual_preparation_worker',expect.objectContaining({p_body:{state:'UNKNOWN',code:'PREPARATION_'+stage.toUpperCase()+'_TIMEOUT'}}));
  expect(JSON.stringify(f.rpc.mock.calls)).not.toContain('PRIVATE_DOCUMENT_AND_KEY');
 });
 it('rejects a result from another organization instead of marking it successful',async()=>{
  const f=fixture();f.closing.prepare.mockResolvedValueOnce({row:{id:'closing',organization_id:'foreign',customer_id:'customer',month:'2026-08',report:{unitIds:[unit]}}});await f.worker.runOnce();expect(f.rpc).toHaveBeenCalledWith('eva_manual_preparation_worker',expect.objectContaining({p_body:expect.objectContaining({state:'UNKNOWN'})}));
 });
 it('keeps one execution in flight and heartbeats without starting another job',async()=>{
  jest.useFakeTimers();const f=fixture();let finish!:(r:any)=>void;f.closing.prepare.mockImplementationOnce(()=>new Promise(resolve=>finish=resolve));const first=f.worker.runOnce();await jest.advanceTimersByTimeAsync(0);await f.worker.runOnce();expect(f.closing.prepare).toHaveBeenCalledTimes(1);await jest.advanceTimersByTimeAsync(30000);expect(f.rpc).toHaveBeenCalledWith('eva_manual_preparation_worker',expect.objectContaining({p_action:'heartbeat'}));finish({row:{id:'closing',organization_id:'org',customer_id:'customer',month:'2026-08',report:{unitIds:[unit]}}});await first;expect(jest.getTimerCount()).toBe(0);
 });
});
