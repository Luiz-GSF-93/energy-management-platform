import {Logger} from '@nestjs/common';
import {monitorEventLoopDelay,performance} from 'node:perf_hooks';
import {RuntimeObservabilityService} from './runtime-observability.service';

jest.mock('node:perf_hooks',()=>({monitorEventLoopDelay:jest.fn(),performance:{now:jest.fn()}}));
describe('bounded, private runtime observations',()=>{
 let monitor:RuntimeObservabilityService;
 let h:any;
 let db:any;
 let log:jest.SpyInstance;
 const originalRole=process.env.ENERGYOS_PROCESS_ROLE;
 beforeEach(()=>{
  jest.useFakeTimers();process.env.ENERGYOS_PROCESS_ROLE='API';
  h={enable:jest.fn(),disable:jest.fn(),reset:jest.fn(),count:2,max:120000000,percentile:jest.fn((n:number)=>n===95?30000000:90000000)};
  (monitorEventLoopDelay as jest.Mock).mockReturnValue(h);
  (performance.now as jest.Mock).mockReturnValueOnce(0).mockReturnValueOnce(0).mockReturnValue(60000);
  jest.spyOn(process,'cpuUsage').mockReturnValueOnce({user:0,system:0}).mockReturnValueOnce({user:0,system:0}).mockReturnValue({user:15000000,system:0});
  db={readiness:jest.fn().mockResolvedValue({database:true,auth:false,checkedAt:'unused',secret:'MUST_NOT_LOG'})};
  log=jest.spyOn(Logger.prototype,'log').mockImplementation(()=>undefined);
  monitor=new RuntimeObservabilityService({get:()=>undefined} as any,db);
 });
 afterEach(()=>{monitor.onModuleDestroy();jest.useRealTimers();jest.restoreAllMocks();jest.clearAllMocks();if(originalRole===undefined)delete process.env.ENERGYOS_PROCESS_ROLE;else process.env.ENERGYOS_PROCESS_ROLE=originalRole;});
 it('samples once per minute, converts nanoseconds and uses CPU per one core',async()=>{
  monitor.onModuleInit();monitor.onModuleInit();
  await jest.advanceTimersByTimeAsync(59999);expect(log).not.toHaveBeenCalled();
  await jest.advanceTimersByTimeAsync(1);
  const r=JSON.parse(log.mock.calls[0][0]);expect(r).toMatchObject({event:'ENERGYOS_RUNTIME_SAMPLE',role:'API',windowMs:60000,cpuPercent:25,eventLoop:{p95Ms:30,p99Ms:90,maxMs:120},polling:{concurrencyLimit:2}});
  expect(h.reset).toHaveBeenCalledTimes(1);expect(monitorEventLoopDelay).toHaveBeenCalledTimes(1);
  expect(JSON.parse(log.mock.calls[1][0])).toEqual({event:'ENERGYOS_DEPENDENCY_SAMPLE',schemaVersion:1,role:'API',database:'up',auth:'down'});
  expect(JSON.stringify(log.mock.calls)).not.toContain('MUST_NOT_LOG');
 });
 it('disables without creating timers, histograms or dependency requests',()=>{
  monitor=new RuntimeObservabilityService({get:()=> 'false'} as any,db);monitor.onModuleInit();expect(monitorEventLoopDelay).not.toHaveBeenCalled();expect(jest.getTimerCount()).toBe(0);expect(db.readiness).not.toHaveBeenCalled();
 });
 it('collects worker pressure without probing authentication or creating an HTTP listener',async()=>{
  process.env.ENERGYOS_PROCESS_ROLE='EVA_WORKER';monitor.onModuleInit();await jest.advanceTimersByTimeAsync(60000);
  expect(JSON.parse(log.mock.calls[0][0]).role).toBe('EVA_WORKER');expect(db.readiness).not.toHaveBeenCalled();expect(log).toHaveBeenCalledTimes(1);
 });
 it('uses null when the histogram has no samples, not a misleading zero delay',async()=>{
  h.count=0;monitor.onModuleInit();await jest.advanceTimersByTimeAsync(60000);expect(JSON.parse(log.mock.calls[0][0]).eventLoop).toEqual({p95Ms:null,p99Ms:null,maxMs:null});expect(h.percentile).not.toHaveBeenCalled();
 });
 it('contains exporter/log failures and does not log raw dependency errors',async()=>{
  db.readiness.mockRejectedValue(Error('private credential and invoice content'));monitor.onModuleInit();await jest.advanceTimersByTimeAsync(60000);
  expect(log.mock.calls[1][0]).toBe('ENERGYOS_DEPENDENCY_SAMPLE_UNAVAILABLE');expect(JSON.stringify(log.mock.calls)).not.toContain('private credential');
  log.mockImplementation(()=>{throw Error('stdout unavailable');});await expect(monitor.sample()).resolves.toBeUndefined();
 });
 it('bounds a stalled dependency and avoids overlapping samples',async()=>{
  db.readiness.mockReturnValue(new Promise(()=>{}));monitor.onModuleInit();await jest.advanceTimersByTimeAsync(60000);
  await monitor.sample();expect(db.readiness).toHaveBeenCalledTimes(1);
  await jest.advanceTimersByTimeAsync(4000);expect(JSON.parse(log.mock.calls[1][0])).toMatchObject({database:'unknown',auth:'unknown'});
  db.readiness.mockResolvedValue({database:true,auth:true});await monitor.sample();expect(db.readiness).toHaveBeenCalledTimes(2);
 });
 it('stops sampling and disables the histogram on shutdown',async()=>{
  monitor.onModuleInit();monitor.onModuleDestroy();await jest.advanceTimersByTimeAsync(120000);expect(log).not.toHaveBeenCalled();expect(h.disable).toHaveBeenCalledTimes(1);expect(jest.getTimerCount()).toBe(0);
 });
 it('does not interrupt bootstrap or shutdown when the local monitor fails',()=>{
  h.enable.mockImplementation(()=>{throw Error('native monitor unavailable');});
  h.disable.mockImplementation(()=>{throw Error('cleanup unavailable');});
  expect(()=>monitor.onModuleInit()).not.toThrow();expect(()=>monitor.onModuleDestroy()).not.toThrow();
  expect(log).toHaveBeenCalledWith('ENERGYOS_RUNTIME_MONITOR_UNAVAILABLE');expect(jest.getTimerCount()).toBe(0);
 });
});
