import {monitoringSnapshot,PlatformMonitoringService} from './platform-monitoring.service';
import {PlatformAdministrationService} from './platform-administration.service';
const NOW=Date.UTC(2026,10,16,11,30),END=NOW/1000;
const names=['energyos_runtime_rss_bytes','energyos_runtime_cpu_percent','energyos_event_loop_p99_milliseconds','energyos_runtime_sample_timestamp_seconds'];
function fixture(role='API',instance='synthetic-instance',sample=END-20,memory=20971520){return names.map((name,i)=>({metric:{__name__:name,process_role:role,service_instance_id:instance,customer_id:'PRIVATE_LABEL_CANARY'},values:[[END-60,String(i===3?sample-60:[memory,2.5,11][i])],[END,String(i===3?sample:[memory,2.5,11][i])]]}));}
const body=(result=[...fixture(),...fixture('EVA_WORKER')])=>({status:'success',data:{resultType:'matrix',result}});
const reply=(data:any)=>new Response(JSON.stringify(data),{headers:{'content-type':'application/json'}});
const setup=()=>new PlatformMonitoringService({get:()=> 'true'} as any);
describe('Owner monitoring with bounded private Prometheus reads',()=>{
 const original=global.fetch;
 beforeEach(()=>{jest.useFakeTimers();jest.setSystemTime(NOW);});
 afterEach(()=>{global.fetch=original;jest.useRealTimers();});
 it('drops labels and keeps the latest instance coherent across all metric fields',()=>{
  const p=monitoringSnapshot(body([...fixture('API','older',END-90,900*1048576),...fixture('API','current',END-10,20*1048576),...fixture('EVA_WORKER')]),NOW);
  expect(p.status).toBe('AVAILABLE');expect(p.roles[0].memoryMiB.at(-1)?.value).toBe(20);expect(p.roles[0].sampledAt).toBe(new Date((END-10)*1000).toISOString());
  expect(JSON.stringify(p)).not.toContain('PRIVATE_LABEL_CANARY');expect(JSON.stringify(p)).not.toContain('service_instance_id');expect(JSON.stringify(p)).not.toContain('current');
 });
 it('does not replace incomplete new-instance metrics with an older complete process',()=>{
  const fresh=fixture('API','current',END-10).filter(x=>x.metric.__name__!==names[1]);
  const p=monitoringSnapshot(body([...fixture('API','old',END-90),...fresh,...fixture('EVA_WORKER')]),NOW);
  expect(p.status).toBe('PARTIAL');expect(p.roles[0].state).toBe('MISSING');expect(p.roles[0].cpuPercent).toEqual([]);
 });
 it('marks a recently missing metric incomplete even when older history still exists',()=>{const f=fixture();f[1].values=[[END-300,'2']];const p=monitoringSnapshot(body([...f,...fixture('EVA_WORKER')]),NOW);expect(p.roles[0].state).toBe('MISSING');expect(p.status).toBe('PARTIAL');});
 it('distinguishes stale, absent and actual zero measurements',()=>{
  const p=monitoringSnapshot(body(fixture('API','old',END-300,0)),NOW);expect(p.status).toBe('PARTIAL');expect(p.roles[0].state).toBe('STALE');expect(p.roles[0].memoryMiB.at(-1)?.value).toBe(0);expect(p.roles[1].state).toBe('MISSING');expect(p.roles[1].sampledAt).toBeNull();
  expect(monitoringSnapshot(body([]),NOW).status).toBe('UNAVAILABLE');
 });
 it.each(['NaN','Infinity','-1','PRIVATE_VALUE_CANARY'])('rejects invalid provider values %s',value=>{const f=fixture();f[0].values[0][1]=value;expect(()=>monitoringSnapshot(body(f),NOW)).toThrow('MONITORING_RESPONSE_INVALID');});
 it('rejects provider cardinality, extra names, foreign roles, duplicate series and out-of-window points',()=>{
  const f=fixture();expect(()=>monitoringSnapshot(body(Array(33).fill(f[0])),NOW)).toThrow();
  for(const patch of [{__name__:'private_invoice'},{process_role:'OTHER_CUSTOMER'}])expect(()=>monitoringSnapshot(body([{...f[0],metric:{...f[0].metric,...patch}}]),NOW)).toThrow();
  expect(()=>monitoringSnapshot(body([...f,f[0]]),NOW)).toThrow();expect(()=>monitoringSnapshot(body([{...f[0],values:[[END+1,'1']]}]),NOW)).toThrow();
 });
 it('uses only one fixed, credential-free request for concurrent owners and a 30 second cache',async()=>{
  let release!:(v:Response)=>void;const f=jest.fn().mockReturnValue(new Promise<Response>(r=>{release=r;}));global.fetch=f;
  const s=setup(),a=s.read(),b=s.read();expect(f).toHaveBeenCalledTimes(1);release(reply(body()));expect((await a).status).toBe('AVAILABLE');expect((await b).status).toBe('AVAILABLE');await s.read();expect(f).toHaveBeenCalledTimes(1);
  const [url,options]=f.mock.calls[0];expect(url.origin).toBe('http://energyos-prometheus.railway.internal:9090');expect(url.pathname).toBe('/api/v1/query_range');expect(url.searchParams.get('step')).toBe('60');expect(url.searchParams.get('timeout')).toBe('1s');
  expect(options).toMatchObject({method:'GET',redirect:'error',credentials:'omit',headers:{Accept:'application/json','Cache-Control':'no-store'}});expect(options.headers.Authorization).toBeUndefined();
 });
 it('re-evaluates source age even while a cached snapshot is reused',async()=>{
  global.fetch=jest.fn().mockResolvedValue(reply(body([...fixture('API','a',END-170),...fixture('EVA_WORKER','b',END-170)])));
  const s=setup();expect((await s.read()).status).toBe('AVAILABLE');await jest.advanceTimersByTimeAsync(15000);expect((await s.read()).status).toBe('PARTIAL');expect(global.fetch).toHaveBeenCalledTimes(1);
 });
 it('ends a provider request after two seconds even if the provider ignores cancellation',async()=>{
  global.fetch=jest.fn().mockReturnValue(new Promise(()=>{}));const s=setup(),p=s.read();await jest.advanceTimersByTimeAsync(2001);expect((await p).status).toBe('UNAVAILABLE');expect((global.fetch as jest.Mock).mock.calls[0][1].signal.aborted).toBe(true);await s.read();expect(global.fetch).toHaveBeenCalledTimes(1);
 });
 it('bounds a stalled response body and clears the single flight',async()=>{
  let close!:()=>void;const stream=new ReadableStream<Uint8Array>({start(controller){close=()=>controller.close();}});
  global.fetch=jest.fn().mockResolvedValue(new Response(stream,{headers:{'content-type':'application/json'}}));const s=setup(),p=s.read();await jest.advanceTimersByTimeAsync(2001);expect((await p).status).toBe('UNAVAILABLE');close();await Promise.resolve();
 });
 it.each(['size','content','failure'])('sanitizes invalid %s without passing provider diagnostics',async kind=>{
  const response=kind==='size'?new Response('x'.repeat(262145),{headers:{'content-type':'application/json'}}):kind==='content'?new Response('PRIVATE_PROVIDER_CANARY',{headers:{'content-type':'text/plain'}}):new Response('PRIVATE_PROVIDER_CANARY',{status:503});global.fetch=jest.fn().mockResolvedValue(response);
  const p=await setup().read();expect(p.status).toBe('UNAVAILABLE');expect(JSON.stringify(p)).not.toContain('PRIVATE_PROVIDER_CANARY');
 });
 it.each([undefined,'false','TRUE'])('requires explicit activation without making an unwanted provider call (%s)',async flag=>{
  global.fetch=jest.fn();expect((await new PlatformMonitoringService({get:()=>flag} as any).read()).status).toBe('DISABLED');expect(global.fetch).not.toHaveBeenCalled();
 });
 it('rechecks the active Owner before cached metrics and clears access after revocation',async()=>{
  global.fetch=jest.fn().mockResolvedValue(reply(body()));const rpc=jest.fn().mockResolvedValueOnce({data:{responsible:'OWNER',rows:[]}}).mockResolvedValueOnce({error:{code:'42501',message:'PRIVATE_SQL_CANARY'}});
  const s=new PlatformAdministrationService({getClient:()=>({rpc})} as any,{} as any,undefined,setup());expect((await s.stability('owner',{})).monitoring?.status).toBe('AVAILABLE');await expect(s.stability('owner',{})).rejects.toMatchObject({status:403});expect(global.fetch).toHaveBeenCalledTimes(1);expect(rpc).toHaveBeenCalledTimes(2);
 });
 it('keeps existing organization counts available when telemetry itself fails',async()=>{
  const rpc=jest.fn().mockResolvedValue({data:{responsible:'OWNER',rows:[{organizationId:'synthetic'}]}}),monitoring={read:jest.fn().mockRejectedValue(Error('PRIVATE_PROVIDER_CANARY'))};
  const s=new PlatformAdministrationService({getClient:()=>({rpc})} as any,{} as any,undefined,monitoring as any);expect((await s.stability('owner',{})).rows).toHaveLength(1);
 });
});
