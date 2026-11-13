import {Injectable,Logger,OnModuleDestroy,OnModuleInit} from '@nestjs/common';
import {ConfigService} from '@nestjs/config';
import {monitorEventLoopDelay,performance} from 'node:perf_hooks';
import {SupabaseService} from '../../services/supabase.service';
import {processRole} from '../workers/process-role';
import {evaPollingMetrics} from '../workers/eva-poller';
import {snapshotEvaStages} from './eva-stage-metrics';
import {RuntimeMetricsExporter} from './runtime-metrics-exporter';

const finite=(n:number)=>Number.isFinite(n)?Math.round(Math.max(0,n)*100)/100:null;

/** Process aggregates only: no request context, tenant identifiers or external exporter. */
@Injectable()
export class RuntimeObservabilityService implements OnModuleInit,OnModuleDestroy {
 private readonly log=new Logger(RuntimeObservabilityService.name);
 private timer?:ReturnType<typeof setInterval>;
 private histogram?:ReturnType<typeof monitorEventLoopDelay>;
 private cpu=process.cpuUsage();
 private at=performance.now();
 private stopped=true;
 private busy=false;
 private role:ReturnType<typeof processRole>='COMBINED';
 private exporter?:RuntimeMetricsExporter;
 constructor(private config:ConfigService,private db:SupabaseService){}

 onModuleInit(){
  if(!this.stopped)return;
  // Missing means enabled; any explicit value other than true disables collection.
  if((this.config.get<string>('ENERGYOS_RUNTIME_OBSERVABILITY_ENABLED')??'true')!=='true')return;
  try{
   this.role=processRole();this.cpu=process.cpuUsage();this.at=performance.now();
   this.exporter=new RuntimeMetricsExporter(this.config.get<string>('ENERGYOS_OTLP_METRICS_ENABLED'),this.config.get<string>('ENERGYOS_OTLP_METRICS_ENDPOINT'));
   this.histogram=monitorEventLoopDelay({resolution:20});this.histogram.enable();
   this.stopped=false;
   this.timer=setInterval(()=>void this.sample(),60000);this.timer.unref();
  }catch{this.onModuleDestroy();this.safeLog('ENERGYOS_RUNTIME_MONITOR_UNAVAILABLE');}
 }

 onModuleDestroy(){
  this.stopped=true;
  if(this.timer)clearInterval(this.timer);
  this.timer=undefined;
  try{this.histogram?.disable();}catch{/* Cleanup must not prevent application shutdown. */}
  this.histogram=undefined;
  this.exporter?.close();this.exporter=undefined;
 }

 private safeLog(value:string){try{this.log.log(value);}catch{/* Monitoring never rejects application work. */}}

 async sample(){
  if(this.stopped||this.busy||!this.histogram)return;
  this.busy=true;
  try{
   const now=performance.now(),cpu=process.cpuUsage(),memory=process.memoryUsage();
   const windowMs=now-this.at,h=this.histogram;
   const cpuPercent=windowMs>0?finite(100*(cpu.user+cpu.system-this.cpu.user-this.cpu.system)/(windowMs*1000)):null;
   this.cpu=cpu;this.at=now;
   const eventLoop=h.count>0?{p95Ms:finite(h.percentile(95)/1e6),p99Ms:finite(h.percentile(99)/1e6),maxMs:finite(h.max/1e6)}:{p95Ms:null,p99Ms:null,maxMs:null};
   h.reset();
   const sample={event:'ENERGYOS_RUNTIME_SAMPLE',schemaVersion:1,role:this.role,
    windowMs:finite(windowMs),uptimeSeconds:finite(process.uptime()),cpuPercent,
    cpuBasis:'one_core_100_percent',rssBytes:memory.rss,heapUsedBytes:memory.heapUsed,
    heapTotalBytes:memory.heapTotal,externalBytes:memory.external,eventLoop,polling:evaPollingMetrics(),stages:snapshotEvaStages()};
   this.safeLog(JSON.stringify({...sample,exporter:this.exporter?.status()}));
   // Synchronous admission only. Network completion is never awaited by EVA or dependency probes.
   this.exporter?.send(sample);
   // The private worker does not probe Auth; API and combined services use the existing cached probes.
   if(this.role!=='EVA_WORKER'){
    let timeout:ReturnType<typeof setTimeout>|undefined;
    try{
     const result=await Promise.race([this.db.readiness(),new Promise<undefined>(resolve=>{timeout=setTimeout(()=>resolve(undefined),4000);timeout.unref();})]);
     if(!this.stopped)this.safeLog(JSON.stringify({event:'ENERGYOS_DEPENDENCY_SAMPLE',schemaVersion:1,role:this.role,
      database:result?(result.database?'up':'down'):'unknown',auth:result?(result.auth?'up':'down'):'unknown'}));
    }catch{if(!this.stopped)this.safeLog('ENERGYOS_DEPENDENCY_SAMPLE_UNAVAILABLE');}
    finally{if(timeout)clearTimeout(timeout);}
   }
  }catch{if(!this.stopped)this.safeLog('ENERGYOS_RUNTIME_SAMPLE_UNAVAILABLE');}
  finally{this.busy=false;}
 }
}
