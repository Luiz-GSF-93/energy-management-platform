import {performance} from 'node:perf_hooks';
import {observeEvaStage,snapshotEvaStages} from './eva-stage-metrics';
jest.mock('node:perf_hooks',()=>({performance:{now:jest.fn()}}));
describe('bounded per-stage measurements without job effects',()=>{
 const before=process.env.ENERGYOS_RUNTIME_OBSERVABILITY_ENABLED;
 beforeEach(()=>{delete process.env.ENERGYOS_RUNTIME_OBSERVABILITY_ENABLED;(performance.now as jest.Mock).mockReset().mockReturnValue(0);snapshotEvaStages();});
 afterEach(()=>{snapshotEvaStages();if(before===undefined)delete process.env.ENERGYOS_RUNTIME_OBSERVABILITY_ENABLED;else process.env.ENERGYOS_RUNTIME_OBSERVABILITY_ENABLED=before;});
 it('returns the exact task result and records one completed duration',async()=>{
  (performance.now as jest.Mock).mockReturnValueOnce(10).mockReturnValueOnce(35.25);
  const result={privateDocument:'must not be retained'},run=jest.fn(()=>result);
  expect(await observeEvaStage('XML_PARSE',run)).toBe(result);expect(run).toHaveBeenCalledTimes(1);
  const metrics=snapshotEvaStages();expect(metrics).toEqual([{stage:'XML_PARSE',active:0,completed:1,failed:0,timed:1,averageMs:25.25,maxMs:25.25}]);
  expect(JSON.stringify(metrics)).not.toContain('privateDocument');expect(snapshotEvaStages()).toEqual([]);
 });
 it('preserves the original exception instance, with no replay or error text in metrics',async()=>{
  const error=Object.assign(Error('credential and source contents'),{code:'UNCERTAIN_WRITE'}),run=jest.fn(async()=>{throw error;});
  await expect(observeEvaStage('CLOSING_PREPARATION',run)).rejects.toBe(error);
  expect(run).toHaveBeenCalledTimes(1);const metrics=snapshotEvaStages();expect(metrics[0].failed).toBe(1);expect(JSON.stringify(metrics)).not.toContain('credential');
 });
 it('retains an active stage across reporting windows and resets completed counters',async()=>{
  let finish!:(v:string)=>void;const task=observeEvaStage('OCR_POLL',()=>new Promise<string>(resolve=>finish=resolve));
  expect(snapshotEvaStages()).toEqual([expect.objectContaining({stage:'OCR_POLL',active:1,completed:0,averageMs:null})]);
  finish('preserved');expect(await task).toBe('preserved');expect(snapshotEvaStages()).toEqual([expect.objectContaining({active:0,completed:1})]);expect(snapshotEvaStages()).toEqual([]);
 });
 it('does not create unbounded keys from arbitrary strings',async()=>{
  for(let i=0;i<100;i++)await observeEvaStage(('document-'+i) as any,()=>i);
  expect(snapshotEvaStages()).toEqual([]);
 });
 it('honors the same telemetry kill switch without skipping application work',async()=>{
  process.env.ENERGYOS_RUNTIME_OBSERVABILITY_ENABLED='false';const run=jest.fn(async()=>42);expect(await observeEvaStage('OCR_SUBMIT',run)).toBe(42);expect(snapshotEvaStages()).toEqual([]);expect(run).toHaveBeenCalledTimes(1);
 });
 it('executes even when the measurement clock fails',async()=>{
  (performance.now as jest.Mock).mockImplementation(()=>{throw Error('clock unavailable');});expect(await observeEvaStage('DRAFT_PREPARATION',()=>42)).toBe(42);expect(snapshotEvaStages()).toEqual([]);
 });
 it('reports missing elapsed measurements as null rather than zero latency',async()=>{
  (performance.now as jest.Mock).mockReturnValueOnce(10).mockReturnValueOnce(NaN);
  await observeEvaStage('IDENTITY_CHECK',()=>true);expect(snapshotEvaStages()).toEqual([expect.objectContaining({completed:1,timed:0,averageMs:null,maxMs:null})]);
 });
});
