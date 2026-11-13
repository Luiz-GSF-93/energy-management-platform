import {Logger} from '@nestjs/common';
import {manualPreparationCommand,MANUAL_PREPARATION_RECEIPT_MS} from './eva-manual-receipt';
import {EvaManualPreparationQueue} from './eva-manual-preparation.queue';
import {EvaManualPreparationWorker} from './eva-manual-preparation.worker';
const id='00000000-0000-4000-8000-000000000100',unit='00000000-0000-4000-8000-000000000001';
const config:any={get:(k:string)=>k==='EVA_MANUAL_PREPARATION_ASYNC_ENABLED'?'true':undefined};
const actor:any={organizationId:'org',userId:'actor',roleId:'role',role:'operacional'};
const flush=async()=>{for(let i=0;i<40;i++)await Promise.resolve();};
describe('bounded manual preparation acknowledgements without command replay',()=>{
 beforeEach(()=>{jest.useFakeTimers();jest.spyOn(Logger.prototype,'warn').mockImplementation(()=>undefined);});
 afterEach(()=>{jest.useRealTimers();jest.restoreAllMocks();});
 it('refuses unrelated financial RPCs and read actions before contacting the database',async()=>{
  const rpc=jest.fn();for(const [name,p_action] of [['calculation_autofill_action','reserve'],['eva_manual_preparation_action','status'],['eva_manual_preparation_worker','approve']])await expect(manualPreparationCommand({rpc},name,{p_action})).rejects.toThrow('NOT_ALLOWLISTED');expect(rpc).not.toHaveBeenCalled();
 });
 it('preserves a confirmed response and clears its timer',async()=>{
  const response={data:{accepted:true}},rpc=jest.fn(async()=>response);expect(await manualPreparationCommand({rpc},'eva_manual_preparation_worker',{p_action:'begin'})).toBe(response);expect(rpc).toHaveBeenCalledTimes(1);expect(jest.getTimerCount()).toBe(0);
 });
 it('aborts an unresponsive transport at the deadline without retrying the command',async()=>{
  let signal:AbortSignal|undefined;const rpc=jest.fn(()=>({abortSignal:(s:AbortSignal)=>{signal=s;return new Promise(()=>{});}}));
  const result=expect(manualPreparationCommand({rpc},'eva_manual_preparation_worker',{p_action:'claim'})).rejects.toMatchObject({status:503});await flush();await jest.advanceTimersByTimeAsync(MANUAL_PREPARATION_RECEIPT_MS);await result;expect(signal?.aborted).toBe(true);await jest.advanceTimersByTimeAsync(60000);expect(rpc).toHaveBeenCalledTimes(1);expect(jest.getTimerCount()).toBe(0);
 });
 it('does not accept a late acknowledgement after reporting uncertainty',async()=>{
  let finish:any;const rpc=jest.fn(()=>new Promise(r=>finish=r));const result=expect(manualPreparationCommand({rpc},'eva_manual_preparation_action',{p_action:'request'})).rejects.toMatchObject({status:503});await flush();await jest.advanceTimersByTimeAsync(MANUAL_PREPARATION_RECEIPT_MS);await result;finish({data:{job:{id}}});await flush();expect(rpc).toHaveBeenCalledTimes(1);expect(jest.getTimerCount()).toBe(0);
 });
 it('turns a transport rejection into an unconfirmed receipt while preserving database denials',async()=>{
  await expect(manualPreparationCommand({rpc:()=>Promise.reject(Error('connection reset'))},'eva_manual_preparation_action',{p_action:'request'})).rejects.toMatchObject({status:503});
  const denial={error:{code:'42501'}};expect(await manualPreparationCommand({rpc:async()=>denial},'eva_manual_preparation_action',{p_action:'request'})).toBe(denial);expect(jest.getTimerCount()).toBe(0);
 });
 it('bounds API submission and keeps the same caller-supplied request protocol',async()=>{
  const rpc=jest.fn(()=>new Promise(()=>{})),queue=new EvaManualPreparationQueue({getClient:()=>({rpc})} as any,config);const result=expect(queue.request({consumerUnitId:unit,month:'2026-04',scopeKind:'UNIT',requestId:id},actor)).rejects.toMatchObject({status:503});await flush();await jest.advanceTimersByTimeAsync(MANUAL_PREPARATION_RECEIPT_MS);await result;expect(rpc).toHaveBeenCalledTimes(1);expect(rpc).toHaveBeenCalledWith('eva_manual_preparation_action_context',expect.objectContaining({p_id:id,p_action:'request'}));
 });
 function workerFixture(hang:'claim'|'begin'|'finish'){
  let finished=false;const job={id,organizationId:'org',customerId:'customer',consumerUnitId:unit,month:'2026-04',scopeKind:'UNIT',executionId:id};
  const rpc=jest.fn(async(_name:string,b:any):Promise<any>=>{
   if(b.p_action==='claim')return hang==='claim'?new Promise(()=>{}):{data:{id,token:'lease'}};
   if(b.p_action==='context')return {data:{job,delegate:{userId:'actor',roleId:'role',role:'operacional',permissions:[]}}};
   if(b.p_action==='begin')return hang==='begin'?new Promise(()=>{}):{data:{accepted:true}};
   if(b.p_action==='finish'){
    if(hang==='finish'&&!finished){finished=true;return new Promise(()=>{});}
    return {error:{code:'40001'}}; // An expired/committed lease cannot be overwritten.
   }
   return {data:{alive:true}};
  });
  const closing={prepare:jest.fn(async()=>({row:{id,organization_id:'org',customer_id:'customer',month:'2026-04',report:{unitIds:[unit]}}}))},db:any={getClient:()=>({rpc})},queue=new EvaManualPreparationQueue(db,config);
  return {rpc,closing,worker:new EvaManualPreparationWorker(db,queue,closing as any)};
 }
 it('releases process admission after an unconfirmed claim without calculating',async()=>{
  const f=workerFixture('claim'),result=expect(f.worker.runOnce()).rejects.toMatchObject({status:503});await flush();await jest.advanceTimersByTimeAsync(MANUAL_PREPARATION_RECEIPT_MS);await result;expect(f.closing.prepare).not.toHaveBeenCalled();f.rpc.mockResolvedValue({data:null});await f.worker.runOnce();expect(f.rpc).toHaveBeenCalledTimes(2);expect(jest.getTimerCount()).toBe(0);
 });
 it('never starts financial preparation after a lost begin acknowledgement',async()=>{
  const f=workerFixture('begin'),result=f.worker.runOnce();await flush();await jest.advanceTimersByTimeAsync(MANUAL_PREPARATION_RECEIPT_MS);await result;expect(f.closing.prepare).not.toHaveBeenCalled();expect(f.rpc.mock.calls.filter(([,b])=>b.p_action==='begin')).toHaveLength(1);expect(f.rpc.mock.calls.filter(([,b])=>b.p_action==='finish')).toHaveLength(1);await jest.advanceTimersByTimeAsync(60000);expect(f.rpc.mock.calls.filter(([,b])=>b.p_action==='begin')).toHaveLength(1);expect(jest.getTimerCount()).toBe(0);
 });
 it('never repeats preparation when the result was committed but its response was lost',async()=>{
  const f=workerFixture('finish'),result=f.worker.runOnce();await flush();await jest.advanceTimersByTimeAsync(MANUAL_PREPARATION_RECEIPT_MS);await result;expect(f.closing.prepare).toHaveBeenCalledTimes(1);const receipts=f.rpc.mock.calls.filter(([,b])=>b.p_action==='finish');expect(receipts.map(([,b])=>b.p_body.state)).toEqual(['SUCCEEDED','UNKNOWN']);await jest.advanceTimersByTimeAsync(60000);expect(f.closing.prepare).toHaveBeenCalledTimes(1);expect(jest.getTimerCount()).toBe(0);
 });
 it('resumes heartbeat checks after a lost contact acknowledgement without repeating preparation',async()=>{
  const f=workerFixture('finish'),original=f.rpc.getMockImplementation()!;let contacts=0,finish:()=>void=()=>{};
  f.rpc.mockImplementation(async(name:string,b:any):Promise<any>=>b.p_action==='heartbeat'?++contacts===1?new Promise(()=>{}):{data:{alive:true}}:b.p_action==='finish'?{data:{}}:original(name,b));
  f.closing.prepare.mockImplementation(()=>new Promise(resolve=>{finish=()=>resolve({row:{id,organization_id:'org',customer_id:'customer',month:'2026-04',report:{unitIds:[unit]}}});}));
  const result=f.worker.runOnce();await flush();await jest.advanceTimersByTimeAsync(30000);expect(contacts).toBe(1);await jest.advanceTimersByTimeAsync(MANUAL_PREPARATION_RECEIPT_MS);await jest.advanceTimersByTimeAsync(30000);expect(contacts).toBe(2);expect(f.closing.prepare).toHaveBeenCalledTimes(1);finish();await result;expect(jest.getTimerCount()).toBe(0);
 });
});
