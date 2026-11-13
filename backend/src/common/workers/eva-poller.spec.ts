import {EvaPoller,wakeEvaWorkers,evaPollingMetrics,evaConcurrencyLimit} from './eva-poller';
import {scheduledWorkEnabled} from './process-role';
describe('EVA process placement and bounded polling',()=>{
 const original=process.env.ENERGYOS_PROCESS_ROLE,originalLimit=process.env.EVA_WORKER_MAX_CONCURRENCY;
 beforeEach(()=>{delete process.env.EVA_WORKER_MAX_CONCURRENCY;});
 afterEach(()=>{if(originalLimit===undefined)delete process.env.EVA_WORKER_MAX_CONCURRENCY;else process.env.EVA_WORKER_MAX_CONCURRENCY=originalLimit;if(original===undefined)delete process.env.ENERGYOS_PROCESS_ROLE;else process.env.ENERGYOS_PROCESS_ROLE=original;jest.useRealTimers();jest.restoreAllMocks();});
 it('keeps combined behavior and fails closed on an unknown role',()=>{delete process.env.ENERGYOS_PROCESS_ROLE;expect(scheduledWorkEnabled('EVA')).toBe(true);expect(scheduledWorkEnabled('API')).toBe(true);process.env.ENERGYOS_PROCESS_ROLE='invalid';expect(()=>scheduledWorkEnabled('EVA')).toThrow();});
 it('separates API timers from the processing service',()=>{process.env.ENERGYOS_PROCESS_ROLE='API';expect(scheduledWorkEnabled('EVA')).toBe(false);expect(scheduledWorkEnabled('API')).toBe(true);process.env.ENERGYOS_PROCESS_ROLE='EVA_WORKER';expect(scheduledWorkEnabled('EVA')).toBe(true);expect(scheduledWorkEnabled('API')).toBe(false);});
 it('slows empty polling and wakes promptly after a new upload',async()=>{jest.useFakeTimers();jest.spyOn(Math,'random').mockReturnValue(0);const p=new EvaPoller(),run=jest.fn().mockResolvedValue(undefined);p.start(run,5000,jest.fn());await jest.advanceTimersByTimeAsync(5000);expect(run).toHaveBeenCalledTimes(1);await jest.advanceTimersByTimeAsync(5000);expect(run).toHaveBeenCalledTimes(1);wakeEvaWorkers();await jest.advanceTimersByTimeAsync(1000);expect(run).toHaveBeenCalledTimes(2);p.stop();expect(jest.getTimerCount()).toBe(0);});
 it('backs off failures without replaying an operation',async()=>{jest.useFakeTimers();jest.spyOn(Math,'random').mockReturnValue(0);const p=new EvaPoller(),run=jest.fn().mockRejectedValue(Error('unknown write')),error=jest.fn();p.start(run,5000,error);await jest.advanceTimersByTimeAsync(5000);expect(evaPollingMetrics()).toEqual({registered:1,activeTasks:0,backingOff:1,concurrencyLimit:1});wakeEvaWorkers();await jest.advanceTimersByTimeAsync(29000);expect(run).toHaveBeenCalledTimes(1);await jest.advanceTimersByTimeAsync(1000);expect(run).toHaveBeenCalledTimes(2);expect(error).toHaveBeenCalledTimes(2);p.stop();expect(evaPollingMetrics()).toEqual({registered:0,activeTasks:0,backingOff:0,concurrencyLimit:1});});
 it('admits at most two EVA jobs only with explicit bounded configuration',async()=>{process.env.EVA_WORKER_MAX_CONCURRENCY='2';jest.useFakeTimers();jest.spyOn(Math,'random').mockReturnValue(0);let release!:()=>void;const pending=new Promise<void>(r=>release=r),ps=[new EvaPoller(),new EvaPoller(),new EvaPoller()],runs=ps.map(p=>jest.fn(async()=>{p.activity();await pending;}));ps.forEach((p,i)=>p.start(runs[i],5000,jest.fn()));await jest.advanceTimersByTimeAsync(5000);expect(runs.map(r=>r.mock.calls.length)).toEqual([1,1,0]);release();await jest.advanceTimersByTimeAsync(1000);expect(runs[2]).toHaveBeenCalledTimes(1);expect(evaPollingMetrics().activeTasks).toBeLessThanOrEqual(2);ps.forEach(p=>p.stop());});
 it.each([undefined,'','1','0','3','999','invalid'])('defaults to one slot for %s',value=>{if(value===undefined)delete process.env.EVA_WORKER_MAX_CONCURRENCY;else process.env.EVA_WORKER_MAX_CONCURRENCY=value;expect(evaConcurrencyLimit()).toBe(1);});
 it('serializes different pollers and keeps an active slot until work settles even after stop',async()=>{jest.useFakeTimers();jest.spyOn(Math,'random').mockReturnValue(0);let release!:()=>void;const pending=new Promise<void>(r=>release=r),a=new EvaPoller(),b=new EvaPoller(),first=jest.fn(()=>pending),second=jest.fn(async()=>{});a.start(first,5000,jest.fn());b.start(second,5000,jest.fn());try{await jest.advanceTimersByTimeAsync(5000);expect(first).toHaveBeenCalledTimes(1);expect(second).not.toHaveBeenCalled();expect(evaPollingMetrics().activeTasks).toBe(1);a.stop();await jest.advanceTimersByTimeAsync(5000);expect(second).not.toHaveBeenCalled();release();await jest.advanceTimersByTimeAsync(5000);expect(second).toHaveBeenCalledTimes(1);expect(evaPollingMetrics().activeTasks).toBe(0);}finally{release();a.stop();b.stop();}});

 it('continues an active backlog after one second and slows down again when empty',async()=>{
  process.env.ENERGYOS_PROCESS_ROLE='EVA_WORKER';jest.useFakeTimers();jest.spyOn(Math,'random').mockReturnValue(0);
  const p=new EvaPoller();let jobs=2;const run=jest.fn(async()=>{if(jobs-->0)p.activity();});p.start(run,5000,jest.fn());
  try{await jest.advanceTimersByTimeAsync(5000);expect(run).toHaveBeenCalledTimes(1);
   await jest.advanceTimersByTimeAsync(999);expect(run).toHaveBeenCalledTimes(1);
   await jest.advanceTimersByTimeAsync(1);expect(run).toHaveBeenCalledTimes(2);
   await jest.advanceTimersByTimeAsync(1000);expect(run).toHaveBeenCalledTimes(3);
   await jest.advanceTimersByTimeAsync(9999);expect(run).toHaveBeenCalledTimes(3);
   await jest.advanceTimersByTimeAsync(1);expect(run).toHaveBeenCalledTimes(4);
  }finally{p.stop();}
 });
 it('wakes blocked work when capacity is released before continuing the current backlog',async()=>{
  process.env.ENERGYOS_PROCESS_ROLE='EVA_WORKER';jest.useFakeTimers();jest.spyOn(Math,'random').mockReturnValue(0);
  let release!:()=>void;const pending=new Promise<void>(r=>release=r),a=new EvaPoller(),b=new EvaPoller(),order:string[]=[];
  a.start(async()=>{order.push('A');a.activity();await pending;},5000,jest.fn());b.start(async()=>{order.push('B');b.activity();await pending;},5000,jest.fn());
  try{await jest.advanceTimersByTimeAsync(5000);expect(order).toEqual(['A']);expect(evaPollingMetrics().activeTasks).toBe(1);
   release();await jest.advanceTimersByTimeAsync(1000);expect(order).toEqual(['A','B','A']);expect(evaPollingMetrics().activeTasks).toBe(0);
  }finally{release();a.stop();b.stop();}
 });
 it('contains diagnostic failures and preserves error backoff',async()=>{
  process.env.ENERGYOS_PROCESS_ROLE='EVA_WORKER';jest.useFakeTimers();jest.spyOn(Math,'random').mockReturnValue(0);
  const p=new EvaPoller(),run=jest.fn(async()=>{throw Error('uncertain write');});p.start(run,5000,()=>{throw Error('log failed');});
  try{await jest.advanceTimersByTimeAsync(5000);expect(evaPollingMetrics().activeTasks).toBe(0);
   await jest.advanceTimersByTimeAsync(29999);expect(run).toHaveBeenCalledTimes(1);
   await jest.advanceTimersByTimeAsync(1);expect(run).toHaveBeenCalledTimes(2);
  }finally{p.stop();}
 });

});
