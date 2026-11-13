import {randomUUID} from 'node:crypto';
import {request,ClientRequest} from 'node:http';
import {EVA_STAGES,EVA_DURATION_BOUNDS_SECONDS,snapshotEvaStageTotals} from './eva-stage-metrics';

type Sample={role:string;rssBytes:number;heapUsedBytes:number;cpuPercent:number|null;uptimeSeconds:number|null;
 eventLoop:{p95Ms:number|null;p99Ms:number|null;maxMs:number|null};
 polling:{activeTasks:number;backingOff:number;concurrencyLimit:number}};
const valid=(value:unknown):value is number=>typeof value==='number'&&Number.isFinite(value)&&value>=0;

/** Explicit, private-only endpoint. No credentials, query, redirects, proxy or arbitrary host. */
export function privateMetricsEndpoint(value:string|undefined){
 try{
  if(!value)return undefined;const u=new URL(value);
  if(u.protocol!=='http:'||u.username||u.password||u.search||u.hash||u.pathname!=='/v1/metrics')return undefined;
  if(!['127.0.0.1','[::1]','localhost','energyos-otel-collector.railway.internal'].includes(u.hostname))return undefined;
  return u;
 }catch{return undefined;}
}

/** OTLP/HTTP JSON metrics only. Rebuild every field; never serialize a request or arbitrary sample. */
export function encodeRuntimeMetrics(sample:Sample,instance:string,totals=snapshotEvaStageTotals()){
 const timeUnixNano=String(BigInt(Date.now())*1000000n);
 const metrics:any[]=[];
 const gauge=(name:string,value:unknown,unit:string,attributes:any[]=[])=>{
  if(valid(value))metrics.push({name,unit,gauge:{dataPoints:[{timeUnixNano,asDouble:value,attributes}]}});
 };
 gauge('energyos_runtime_sample_timestamp_seconds',Date.now()/1000,'s');
 if(!['API','EVA_WORKER','COMBINED'].includes(sample.role))throw Error('INVALID_METRICS_ROLE');
 gauge('energyos_runtime_rss_bytes',sample.rssBytes,'By');gauge('energyos_runtime_heap_used_bytes',sample.heapUsedBytes,'By');
 gauge('energyos_runtime_cpu_percent',sample.cpuPercent,'%');gauge('energyos_runtime_uptime_seconds',sample.uptimeSeconds,'s');
 gauge('energyos_event_loop_p95_milliseconds',sample.eventLoop.p95Ms,'ms');gauge('energyos_event_loop_p99_milliseconds',sample.eventLoop.p99Ms,'ms');
 gauge('energyos_event_loop_max_milliseconds',sample.eventLoop.maxMs,'ms');gauge('energyos_poller_active',sample.polling.activeTasks,'{task}');
 gauge('energyos_poller_backing_off',sample.polling.backingOff,'{poller}');gauge('energyos_poller_limit',sample.polling.concurrencyLimit,'{task}');
 const histograms:any[]=[],completed:any[]=[],failed:any[]=[];
 for(const stage of EVA_STAGES){
  const t=totals.stages.find(x=>x.stage===stage);if(!t)continue;
  const attributes=[{key:'stage',value:{stringValue:stage}}];
  const base={startTimeUnixNano:totals.startedAtUnixNano,timeUnixNano,attributes};
  if(valid(t.completed))completed.push({...base,asDouble:t.completed});
  if(valid(t.failed))failed.push({...base,asDouble:t.failed});
  if(Number.isSafeInteger(t.count)&&t.count>=0&&valid(t.sumSeconds)&&t.bucketCounts.length===EVA_DURATION_BOUNDS_SECONDS.length+1&&
   t.bucketCounts.every(n=>Number.isSafeInteger(n)&&n>=0)&&t.bucketCounts.reduce((a,b)=>a+b,0)===t.count){
   histograms.push({...base,count:String(t.count),sum:t.sumSeconds,explicitBounds:[...EVA_DURATION_BOUNDS_SECONDS],bucketCounts:t.bucketCounts.map(String)});
  }
 }
 if(histograms.length)metrics.push({name:'energyos_eva_stage_duration_seconds',unit:'s',histogram:{aggregationTemporality:2,dataPoints:histograms}});
 if(completed.length)metrics.push({name:'energyos_eva_stage_completed_total',unit:'{operation}',sum:{aggregationTemporality:2,isMonotonic:true,dataPoints:completed}});
 if(failed.length)metrics.push({name:'energyos_eva_stage_failed_total',unit:'{operation}',sum:{aggregationTemporality:2,isMonotonic:true,dataPoints:failed}});
 return JSON.stringify({resourceMetrics:[{resource:{attributes:[
  {key:'service.name',value:{stringValue:'energyos-'+sample.role.toLowerCase()}},
  {key:'service.instance.id',value:{stringValue:instance}},
  {key:'process.role',value:{stringValue:sample.role}}
 ]},scopeMetrics:[{scope:{name:'energyos.fixed-runtime-metrics',version:'1'},metrics}]}]});
}

/** Best effort, one in-flight request, <=32KiB, 2s total deadline, no queue/retry/replay. */
export class RuntimeMetricsExporter{
 private endpoint?:URL;private pending?:ClientRequest;private stopped=false;
 private timer?:ReturnType<typeof setTimeout>;private nextAt=0;private failures=0;
 private sent=0;private dropped=0;private readonly instance=randomUUID();
 constructor(enabled:string|undefined,endpoint:string|undefined){if(enabled==='true')this.endpoint=privateMetricsEndpoint(endpoint);}
 status(){return {enabled:!!this.endpoint&&!this.stopped,inFlight:!!this.pending,sent:this.sent,dropped:this.dropped,failures:this.failures};}
 send(sample:Sample){
  if(!this.endpoint||this.stopped)return;
  if(this.pending||Date.now()<this.nextAt){this.dropped++;return;}
  try{
   const body=encodeRuntimeMetrics(sample,this.instance);
   if(Buffer.byteLength(body)>32768){this.dropped++;return;}
   let settled=false;
   const finish=(ok:boolean)=>{
    if(settled)return;settled=true;clearTimeout(this.timer);this.timer=undefined;this.pending=undefined;
    if(ok){this.sent++;this.failures=0;this.nextAt=Date.now()+60000;}
    else{this.failures=Math.min(4,this.failures+1);this.dropped++;this.nextAt=Date.now()+Math.min(300000,60000*2**(this.failures-1));}
   };
   const req=request(this.endpoint,{method:'POST',agent:false,headers:{'content-type':'application/json','content-length':Buffer.byteLength(body)}},res=>{
    // Read a bounded OTLP receipt; never log its contents or follow redirects.
    if(res.statusCode!==200){res.destroy();finish(false);return;}
    let receipt='';let bytes=0;
    res.on('data',(chunk:Buffer)=>{bytes+=chunk.length;if(bytes>1024){finish(false);res.destroy();}else receipt+=chunk.toString('utf8');});
    res.once('error',()=>finish(false));res.once('aborted',()=>finish(false));
    res.once('end',()=>{
     try{const r=receipt?JSON.parse(receipt):{};finish(r!==null&&typeof r==='object'&&!Array.isArray(r)&&
      (!r.partialSuccess||String(r.partialSuccess.rejectedDataPoints??'0')==='0'));}catch{finish(false);}
    });
   });
   this.pending=req;
   req.once('error',()=>finish(false));req.once('close',()=>finish(false));
   this.timer=setTimeout(()=>{finish(false);req.destroy();},2000);this.timer.unref();
   req.end(body);
  }catch{this.pending?.destroy();this.pending=undefined;clearTimeout(this.timer);this.timer=undefined;this.dropped++;this.nextAt=Date.now()+60000;}
 }
 close(){this.stopped=true;clearTimeout(this.timer);this.timer=undefined;this.pending?.destroy();this.pending=undefined;}
}
