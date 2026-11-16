import {Injectable} from '@nestjs/common';
import {ConfigService} from '@nestjs/config';

const SOURCE='http://energyos-prometheus.railway.internal:9090/api/v1/query_range';
const NAMES=['energyos_runtime_rss_bytes','energyos_runtime_cpu_percent','energyos_event_loop_p99_milliseconds','energyos_runtime_sample_timestamp_seconds'] as const;
const ROLES=['API','EVA_WORKER'] as const;
const MAX_BYTES=262144,TTL=30000,TIMEOUT=2000;
export type MonitoringPoint={at:number;value:number};
export type MonitoringRole={role:typeof ROLES[number];state:'FRESH'|'STALE'|'MISSING';sampledAt:string|null;memoryMiB:MonitoringPoint[];cpuPercent:MonitoringPoint[];eventLoopMs:MonitoringPoint[]};
export type MonitoringSnapshot={status:'AVAILABLE'|'PARTIAL'|'UNAVAILABLE'|'DISABLED';receivedAt:string;windowStart:number;windowEnd:number;roles:MonitoringRole[]};
function empty(now:number,status:MonitoringSnapshot['status']):MonitoringSnapshot{
 const end=Math.floor(now/60000)*60;
 return {status,receivedAt:new Date(now).toISOString(),windowStart:end-1800,windowEnd:end,roles:ROLES.map(role=>({role,state:'MISSING',sampledAt:null,memoryMiB:[],cpuPercent:[],eventLoopMs:[]}))};
}
function currentAge(value:MonitoringSnapshot):MonitoringSnapshot{
 const roles=value.roles.map(r=>r.state==='MISSING'?{...r}:{...r,state:(Date.now()-Date.parse(r.sampledAt!))<=180000?'FRESH' as const:'STALE' as const});
 return {...value,roles,status:value.status==='DISABLED'?'DISABLED':roles.every(r=>r.state==='FRESH')?'AVAILABLE':roles.some(r=>r.sampledAt!==null)?'PARTIAL':'UNAVAILABLE'};
}

/** Private fixed query. No client URLs, PromQL, provider labels or credentials leave this adapter. */
export function monitoringSnapshot(body:unknown,now:number):MonitoringSnapshot{
 const out=empty(now,'UNAVAILABLE'),data=body as any;
 if(data?.status!=='success'||data.data?.resultType!=='matrix'||!Array.isArray(data.data.result)||data.data.result.length>32)throw Error('MONITORING_RESPONSE_INVALID');
 const groups=new Map<string,{role:typeof ROLES[number];metrics:Map<string,MonitoringPoint[]>}>();
 for(const series of data.data.result){
  const m=series?.metric,name=m?.__name__,role=m?.process_role,instance=m?.service_instance_id;
  if(!NAMES.includes(name)||!ROLES.includes(role)||typeof instance!=='string'||instance.length<1||instance.length>128||!Array.isArray(series.values)||series.values.length>31)throw Error('MONITORING_RESPONSE_INVALID');
  const points:MonitoringPoint[]=[];let previous=-1;
  for(const pair of series.values){
   if(!Array.isArray(pair)||pair.length!==2||typeof pair[0]!=='number'||!Number.isFinite(pair[0])||pair[0]<out.windowStart||pair[0]>out.windowEnd||pair[0]<=previous||typeof pair[1]!=='string'||pair[1].trim()==='')throw Error('MONITORING_RESPONSE_INVALID');
   const value=Number(pair[1]);if(!Number.isFinite(value)||value<0||value>2**50)throw Error('MONITORING_RESPONSE_INVALID');
   previous=pair[0];points.push({at:pair[0],value});
  }
  const key=JSON.stringify([role,instance]),g=groups.get(key)??{role,metrics:new Map<string,MonitoringPoint[]>()};
  if(g.metrics.has(name))throw Error('MONITORING_RESPONSE_INVALID');g.metrics.set(name,points);groups.set(key,g);
 }
 for(const row of out.roles){
  const candidates=[...groups.values()].filter(g=>g.role===row.role).map(g=>({g,sample:g.metrics.get(NAMES[3])?.at(-1)?.value})).filter(x=>typeof x.sample==='number'&&x.sample>0&&x.sample<=now/1000+60).sort((a,b)=>b.sample!-a.sample!);
  const selected=candidates[0];if(!selected)continue;
  const sample=selected.sample!,g=selected.g,complete=NAMES.every(n=>(g.metrics.get(n)?.at(-1)?.at??0)>=out.windowEnd-120);
  row.sampledAt=new Date(sample*1000).toISOString();row.state=now/1000-sample>180?'STALE':complete?'FRESH':'MISSING';
  row.memoryMiB=(g.metrics.get(NAMES[0])??[]).map(p=>({...p,value:p.value/1048576}));row.cpuPercent=g.metrics.get(NAMES[1])??[];row.eventLoopMs=g.metrics.get(NAMES[2])??[];
 }
 out.status=out.roles.every(r=>r.state==='FRESH')?'AVAILABLE':out.roles.some(r=>r.sampledAt!==null)?'PARTIAL':'UNAVAILABLE';
 return out;
}

@Injectable()
export class PlatformMonitoringService{
 private cached?:{until:number;value:MonitoringSnapshot};private pending?:Promise<MonitoringSnapshot>;
 constructor(private readonly config:ConfigService){}
 /** Caller must perform a fresh active-Owner authorization before every read, including cached reads. */
 async read():Promise<MonitoringSnapshot>{
  if(this.config.get('ENERGYOS_OWNER_MONITORING_ENABLED')!=='true')return empty(Date.now(),'DISABLED');
  if(this.cached&&this.cached.until>Date.now())return currentAge(this.cached.value);
  if(this.pending)return this.pending.then(currentAge);
  this.pending=this.load().then(value=>{this.cached={until:Date.now()+TTL,value};return value;}).finally(()=>{this.pending=undefined;});
  return this.pending.then(currentAge);
 }
 private async load():Promise<MonitoringSnapshot>{
  const now=Date.now(),fallback=empty(now,'UNAVAILABLE'),url=new URL(SOURCE);
  url.search=new URLSearchParams({query:`{__name__=~"${NAMES.join('|')}",process_role=~"API|EVA_WORKER"}`,start:String(fallback.windowStart),end:String(fallback.windowEnd),step:'60',timeout:'1s'}).toString();
  const abort=new AbortController();let timer:ReturnType<typeof setTimeout>|undefined;
  const deadline=new Promise<never>((_,reject)=>{timer=setTimeout(()=>{abort.abort();reject(Error('MONITORING_TIMEOUT'));},TIMEOUT);});
  try{return await Promise.race([this.source(url,now,abort.signal),deadline]);}catch{return fallback;}finally{clearTimeout(timer);}
 }
 private async source(url:URL,now:number,signal:AbortSignal):Promise<MonitoringSnapshot>{
  const fallback=empty(now,'UNAVAILABLE');
  try{
   const response=await fetch(url,{method:'GET',redirect:'error',credentials:'omit',headers:{Accept:'application/json','Cache-Control':'no-store'},signal});
   if(!response.ok||response.headers.get('content-type')?.split(';')[0].trim()!=='application/json'||Number(response.headers.get('content-length')??0)>MAX_BYTES){await response.body?.cancel();return fallback;}
   const reader=response.body?.getReader();if(!reader)return fallback;
   const chunks:Uint8Array[]=[];let bytes=0;
   try{for(;;){const {done,value}=await reader.read();if(done)break;bytes+=value.byteLength;if(bytes>MAX_BYTES){await reader.cancel();return fallback;}chunks.push(value);}}finally{reader.releaseLock();}
   const buffer=new Uint8Array(bytes);let offset=0;for(const chunk of chunks){buffer.set(chunk,offset);offset+=chunk.length;}
   return monitoringSnapshot(JSON.parse(new TextDecoder().decode(buffer)),now);
  }catch{return fallback;}
 }
}
