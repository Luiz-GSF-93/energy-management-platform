import {performance} from 'node:perf_hooks';

export const EVA_STAGES=['ORIGINAL_DOWNLOAD','OCR_SUBMIT','OCR_POLL','PDF_TEXT','XML_PARSE','IDENTITY_CHECK','ARCHIVE_COPY','SOURCE_CHECK','PREPARED_CHECKPOINT','DRAFT_PREPARATION','FIELD_DRAFT','CLOSING_PREPARATION','CCEE_HISTORY_READ','EXPLANATION_INSPECT','AI_INTERPRETATION','MANUAL_PREPARATION'] as const;
const stages=EVA_STAGES;
export type EvaStage=typeof stages[number];
export const EVA_DURATION_BOUNDS_SECONDS=[.025,.05,.1,.25,.5,1,2,5,10,30,60,120,300,600,1800] as const;
type Total={stage:EvaStage;completed:number;failed:number;count:number;sumSeconds:number;bucketCounts:number[]};
const totals=new Map<EvaStage,Total>();
const startedAtUnixNano=String(BigInt(Date.now())*1000000n);
type Window={active:number;completed:number;failed:number;timed:number;totalMs:number;maxMs:number};
const windows=new Map<EvaStage,Window>();
const enabled=()=> (process.env.ENERGYOS_RUNTIME_OBSERVABILITY_ENABLED??'true')==='true';

/** Aggregates have a fixed key set. No document, tenant, input or error text is retained. */
export async function observeEvaStage<T>(stage:EvaStage,run:()=>T):Promise<Awaited<T>>{
 let window:Window|undefined,started:number|undefined;
 try{
  if(enabled()&&(stages as readonly string[]).includes(stage)){
   started=performance.now();window=windows.get(stage);
   if(!window){window={active:0,completed:0,failed:0,timed:0,totalMs:0,maxMs:0};windows.set(stage,window);}
   window.active++;
  }
 }catch{/* Measurement never prevents execution. */}
 let failed=false;
 try{return await run();}
 catch(error){failed=true;throw error;}
 finally{
  try{
   if(window&&started!==undefined){
    window.active=Math.max(0,window.active-1);window.completed++;if(failed)window.failed++;
    let total=totals.get(stage);
    if(!total){total={stage,completed:0,failed:0,count:0,sumSeconds:0,bucketCounts:Array(EVA_DURATION_BOUNDS_SECONDS.length+1).fill(0)};totals.set(stage,total);}
    total.completed++;if(failed)total.failed++;
    const ms=performance.now()-started;
    if(Number.isFinite(ms)&&ms>=0){
     window.timed++;window.totalMs+=ms;window.maxMs=Math.max(window.maxMs,ms);
     const seconds=ms/1000;let bucket=EVA_DURATION_BOUNDS_SECONDS.findIndex(bound=>seconds<=bound);if(bucket<0)bucket=EVA_DURATION_BOUNDS_SECONDS.length;
     total.count++;total.sumSeconds+=seconds;total.bucketCounts[bucket]++;
    }
   }
  }catch{/* The original task result/error remains authoritative. */}
 }
}

/** Non-draining cumulative histograms; a fixed number of counters, never individual durations. */
export function snapshotEvaStageTotals(){
 return {startedAtUnixNano,stages:[...totals.values()].map(t=>({...t,bucketCounts:[...t.bucketCounts]}))};
}

/** Drains completed-window counters, retaining only in-flight counts across windows. */
export function snapshotEvaStages(){
 const result=[];
 for(const [stage,w] of windows){
  if(w.completed||w.active)result.push({stage,active:w.active,completed:w.completed,failed:w.failed,timed:w.timed,
   averageMs:w.timed?Math.round(w.totalMs/w.timed*100)/100:null,maxMs:w.timed?Math.round(w.maxMs*100)/100:null});
  w.completed=0;w.failed=0;w.timed=0;w.totalMs=0;w.maxMs=0;
  if(!w.active)windows.delete(stage);
 }
 return result;
}
