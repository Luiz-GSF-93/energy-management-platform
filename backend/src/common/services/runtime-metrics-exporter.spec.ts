import {createServer,Server} from 'node:http';
import {once} from 'node:events';
import {RuntimeMetricsExporter,encodeRuntimeMetrics,privateMetricsEndpoint} from './runtime-metrics-exporter';
import {EVA_DURATION_BOUNDS_SECONDS,EVA_STAGES,observeEvaStage,snapshotEvaStageTotals,snapshotEvaStages} from './eva-stage-metrics';

const sample={role:'EVA_WORKER' as const,rssBytes:1,heapUsedBytes:2,cpuPercent:3,uptimeSeconds:4,
 eventLoop:{p95Ms:5,p99Ms:6,maxMs:7},polling:{activeTasks:1,backingOff:0,concurrencyLimit:1}};
const until=async(predicate:()=>boolean,limit=3000)=>{const end=Date.now()+limit;while(!predicate()){if(Date.now()>end)throw Error('metric receipt deadline');await new Promise(r=>setTimeout(r,10));}};

describe('isolated bounded metrics export',()=>{
 let server:Server,exporter:RuntimeMetricsExporter|undefined,endpoint:string;
 beforeEach(async()=>{server=createServer();server.listen(0,'127.0.0.1');await once(server,'listening');endpoint=`http://127.0.0.1:${(server.address() as any).port}/v1/metrics`;});
 afterEach(async()=>{exporter?.close();server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));jest.restoreAllMocks();});
 it.each(['https://example.com/v1/metrics','http://169.254.169.254/v1/metrics','http://evil.railway.internal/v1/metrics','http://energyos-otel-collector.railway.internal.evil.com/v1/metrics','http://user:secret@localhost/v1/metrics','http://localhost/v1/metrics?token=x','http://localhost/v1/metrics#secret','http://localhost/other','not-url'])('rejects unsafe destination %s',value=>{expect(privateMetricsEndpoint(value)).toBeUndefined();});
 it('allows only explicit private/loopback endpoints',()=>{expect(privateMetricsEndpoint(endpoint)).toBeDefined();expect(privateMetricsEndpoint('http://energyos-otel-collector.railway.internal:4318/v1/metrics')).toBeDefined();});
 it('is disabled by default, including a provided destination',()=>{exporter=new RuntimeMetricsExporter(undefined,endpoint);exporter.send(sample);expect(exporter.status()).toEqual({enabled:false,inFlight:false,sent:0,dropped:0,failures:0});});
 it('sends a fixed private metric schema without document, tenant, result or error text',async()=>{
  let body='',headers:any;server.on('request',(req,res)=>{headers=req.headers;req.on('data',c=>body+=c);req.on('end',()=>res.end('{}'));});
  exporter=new RuntimeMetricsExporter('true',endpoint);exporter.send({...sample,organization:'secret-tenant',document:'secret-pdf',token:'secret-key',values:[900000]} as any);
  await until(()=>exporter!.status().sent===1);
  const payload=JSON.parse(body);expect(body).not.toMatch(/secret|authorization|cookie|"values"/i);expect(headers.authorization).toBeUndefined();expect(headers.cookie).toBeUndefined();
  expect(payload.resourceMetrics[0].resource.attributes.map((a:any)=>a.key)).toEqual(['service.name','service.instance.id','process.role']);
  expect(body.length).toBeLessThan(32768);expect(exporter.status().inFlight).toBe(false);
 });
 it.each(['','{"partialSuccess":{}}'])('accepts valid empty/non-rejected OTLP receipts',async receipt=>{
  server.on('request',(_req,res)=>res.end(receipt));exporter=new RuntimeMetricsExporter('true',endpoint);exporter.send(sample);
  await until(()=>exporter!.status().sent===1);expect(exporter.status().failures).toBe(0);
 });
 it('does not block business work or overlap requests when the collector stalls',async()=>{
  let calls=0;server.on('request',()=>calls++);exporter=new RuntimeMetricsExporter('true',endpoint);exporter.send(sample);
  exporter.send(sample);expect(await observeEvaStage('XML_PARSE',()=>42)).toBe(42);
  await until(()=>exporter!.status().failures===1);expect(calls).toBe(1);expect(exporter.status()).toMatchObject({inFlight:false,dropped:2,sent:0});
  exporter.send(sample);expect(exporter.status().inFlight).toBe(false);expect(calls).toBe(1);
 });
 it.each([302,429,503])('does not follow or retry HTTP %s',async status=>{
  let calls=0;server.on('request',(_req,res)=>{calls++;res.writeHead(status,{location:endpoint});res.end('private error');});
  exporter=new RuntimeMetricsExporter('true',endpoint);exporter.send(sample);await until(()=>exporter!.status().failures===1);
  exporter.send(sample);expect(calls).toBe(1);expect(exporter.status().inFlight).toBe(false);
 });
 it.each(['{"partialSuccess":{"rejectedDataPoints":"4","errorMessage":"private"}}','not-json','x'.repeat(2048)])('contains invalid/partial/oversized receipts',async receipt=>{
  server.on('request',(_req,res)=>res.end(receipt));exporter=new RuntimeMetricsExporter('true',endpoint);exporter.send(sample);
  await until(()=>exporter!.status().failures===1);expect(exporter.status().sent).toBe(0);
 });
 it('recovers after cooldown without retaining or replaying an old sample',async()=>{
  const bodies:any[]=[];let fail=true;server.on('request',(req,res)=>{let b='';req.on('data',c=>b+=c);req.on('end',()=>{bodies.push(JSON.parse(b));res.statusCode=fail?503:200;res.end('{}');});});
  exporter=new RuntimeMetricsExporter('true',endpoint);exporter.send(sample);await until(()=>exporter!.status().failures===1);
  fail=false;const clock=jest.spyOn(Date,'now').mockReturnValue(Date.now()+61000);exporter.send({...sample,rssBytes:99});clock.mockRestore();
  await until(()=>exporter!.status().sent===1);expect(bodies).toHaveLength(2);
  expect(bodies[1].resourceMetrics[0].scopeMetrics[0].metrics.find((m:any)=>m.name==='energyos_runtime_rss_bytes').gauge.dataPoints[0].asDouble).toBe(99);
  expect(exporter.status().failures).toBe(0);
 });
 it('cancels active transport on shutdown and cannot start another export',async()=>{
  server.on('request',()=>undefined);exporter=new RuntimeMetricsExporter('true',endpoint);exporter.send(sample);expect(exporter.status().inFlight).toBe(true);
  exporter.close();exporter.send(sample);expect(exporter.status()).toMatchObject({enabled:false,inFlight:false});
 });
 it('bounds cumulative histograms independently of draining log windows',async()=>{
  const before=snapshotEvaStageTotals().stages.find(s=>s.stage==='XML_PARSE')?.count??0;
  for(let i=0;i<10000;i++)await observeEvaStage('XML_PARSE',()=>i);
  snapshotEvaStages();const totals=snapshotEvaStageTotals();const t=totals.stages.find(s=>s.stage==='XML_PARSE')!;
  expect(t.count-before).toBe(10000);expect(t.bucketCounts).toHaveLength(EVA_DURATION_BOUNDS_SECONDS.length+1);expect(t.bucketCounts.reduce((a,b)=>a+b,0)).toBe(t.count);
  t.bucketCounts[0]=-1;expect(snapshotEvaStageTotals().stages.find(s=>s.stage==='XML_PARSE')!.bucketCounts[0]).toBeGreaterThanOrEqual(0);
  const body=encodeRuntimeMetrics(sample,'synthetic-instance');const data=JSON.parse(body).resourceMetrics[0].scopeMetrics[0].metrics;
  const h=data.find((m:any)=>m.name==='energyos_eva_stage_duration_seconds').histogram;
  expect(h.aggregationTemporality).toBe(2);expect(h.dataPoints[0].bucketCounts).toHaveLength(EVA_DURATION_BOUNDS_SECONDS.length+1);
  expect(totals.stages.length).toBeLessThanOrEqual(EVA_STAGES.length);expect(body.length).toBeLessThan(32768);
 });
 it('omits invalid or unavailable measurements instead of fabricating zeros',()=>{
  const body=encodeRuntimeMetrics({...sample,cpuPercent:NaN,eventLoop:{p95Ms:null,p99Ms:Infinity,maxMs:-1}},'synthetic-instance');
  expect(body).not.toContain('energyos_runtime_cpu_percent');expect(body).not.toContain('energyos_event_loop');
 });
});
