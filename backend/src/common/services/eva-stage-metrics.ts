import {performance} from 'node:perf_hooks';

const stages=['ORIGINAL_DOWNLOAD','OCR_SUBMIT','OCR_POLL','PDF_TEXT','XML_PARSE','IDENTITY_CHECK','ARCHIVE_COPY','SOURCE_CHECK','PREPARED_CHECKPOINT','DRAFT_PREPARATION','FIELD_DRAFT','CLOSING_PREPARATION','CCEE_HISTORY_READ','EXPLANATION_INSPECT','AI_INTERPRETATION','MANUAL_PREPARATION'] as const;
export type EvaStage=typeof stages[number];
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
    const ms=performance.now()-started;
    if(Number.isFinite(ms)&&ms>=0){window.timed++;window.totalMs+=ms;window.maxMs=Math.max(window.maxMs,ms);}
   }
  }catch{/* The original task result/error remains authoritative. */}
 }
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
