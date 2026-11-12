import {ForbiddenException} from '@nestjs/common';
import {boundedRestReads,EvaReadUnavailable,readDeadline,readRpc} from './read-deadline';
describe('bounded read-only transport and RPC',()=>{
 afterEach(()=>jest.useRealTimers());
 it('aborts a stalled read and returns an explicitly read-only error',async()=>{
  jest.useFakeTimers();let signal:AbortSignal;const request=readDeadline('closing:inspect',s=>{signal=s;return new Promise(()=>{});},100);
  const rejected=expect(request).rejects.toBeInstanceOf(EvaReadUnavailable);await jest.advanceTimersByTimeAsync(100);await rejected;expect(signal!.aborted).toBe(true);expect(jest.getTimerCount()).toBe(0);
 });
 it('preserves permission failures and does not retry them',async()=>{
  const run=jest.fn(async()=>{throw new ForbiddenException('denied');});await expect(readDeadline('closing:inspect',run)).rejects.toThrow('denied');expect(run).toHaveBeenCalledTimes(1);
 });
 it('forbids reserve, finish and decide in the read RPC helper before calling the database',async()=>{
  const db={rpc:jest.fn()};for(const action of ['reserve','finish','decide'])await expect(readRpc(db,'eva_scoped_closing_action',{p_action:action})).rejects.toThrow('NOT_ALLOWLISTED');expect(db.rpc).not.toHaveBeenCalled();
 });
 it('distinguishes a database read timeout from permission and source errors',async()=>{
  const db={rpc:jest.fn(async()=>({error:{code:'57014'}}))};await expect(readRpc(db,'eva_scoped_closing_action',{p_action:'capture'})).rejects.toBeInstanceOf(EvaReadUnavailable);
  for(const code of ['42501','40001']){db.rpc.mockResolvedValue({error:{code}});expect(await readRpc(db,'eva_scoped_closing_action',{p_action:'history'})).toEqual({error:{code}});}
 });
 it('bounds a stalled REST SELECT without replaying it',async()=>{
  jest.useFakeTimers();const transport=jest.fn((_input:any,init?:any)=>new Promise<Response>((_resolve,reject)=>{
   init.signal.addEventListener('abort',()=>reject(Object.assign(Error('aborted'),{name:'AbortError'})));
  }));
  const request=boundedRestReads(transport as typeof fetch,100)('https://example.invalid/rest/v1/documents');const rejected=expect(request).rejects.toThrow('aborted');await jest.advanceTimersByTimeAsync(100);await rejected;expect(transport).toHaveBeenCalledTimes(1);expect(jest.getTimerCount()).toBe(0);
 });
 it('does not alter mutations, uploads or authentication',async()=>{
  const transport=jest.fn(async(_input:any,_init?:RequestInit)=>new Response('{}'));const wrapped=boundedRestReads(transport as typeof fetch,100);
  for(const [path,method] of [['/rest/v1/documents','POST'],['/rest/v1/documents','PATCH'],['/rest/v1/documents','DELETE'],['/rest/v1/rpc/action','POST'],['/storage/v1/object/file','GET'],['/auth/v1/user','GET']]){const init={method};await wrapped('https://example.invalid'+path,init);expect(transport.mock.calls.at(-1)![1]).toBe(init);}
 });
 it('retains caller cancellation and does not retry a cancelled SELECT',async()=>{
  const caller=new AbortController();caller.abort();const transport=jest.fn(async(_input:any,init:any)=>{expect(init.signal.aborted).toBe(true);return new Response('{}');});await boundedRestReads(transport as typeof fetch)('https://example.invalid/rest/v1/documents',{signal:caller.signal});expect(transport).toHaveBeenCalledTimes(1);
 });
});
