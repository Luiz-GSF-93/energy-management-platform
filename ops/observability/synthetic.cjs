// Anonymous CPU-only fixture. Never imports Nest modules, Supabase, OCR or financial services.
const {RuntimeMetricsExporter}=require('../../backend/dist/common/services/runtime-metrics-exporter');
const {observeEvaStage}=require('../../backend/dist/common/services/eva-stage-metrics');
const {performance}=require('node:perf_hooks');
async function main(){
 const unavailable=process.argv.includes('--unavailable');
 const exporter=new RuntimeMetricsExporter('true',process.env.ENERGYOS_SYNTHETIC_ENDPOINT??'http://127.0.0.1:14318/v1/metrics');
 const at=performance.now();
 for(let i=0;i<10000;i++)await observeEvaStage('XML_PARSE',()=>i);
 exporter.send({role:'EVA_WORKER',rssBytes:unavailable?202:101,heapUsedBytes:40,cpuPercent:1,uptimeSeconds:123,
  eventLoop:{p95Ms:20,p99Ms:25,maxMs:30},polling:{activeTasks:0,backingOff:0,concurrencyLimit:1}});
 const result=await observeEvaStage('IDENTITY_CHECK',()=>42),businessMs=performance.now()-at;
 if(result!==42||businessMs>1500)throw Error('synthetic business work delayed');
 const end=Date.now()+4000;
 while(exporter.status().inFlight&&Date.now()<end)await new Promise(r=>setTimeout(r,10));
 const status=exporter.status();exporter.close();
 if(unavailable?status.sent!==0||status.failures!==1:status.sent!==1)throw Error('unexpected export state');
 console.log(JSON.stringify({fixture:'anonymous_cpu_only',businessResult:result,businessMs:Math.round(businessMs),exporter:status}));
}
main().catch(()=>{console.error('ISOLATED_SYNTHETIC_FAILED');process.exitCode=1;});
