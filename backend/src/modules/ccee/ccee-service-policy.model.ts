import {createHash} from 'node:crypto';
const canonical=(value:any):string=>JSON.stringify(value&&typeof value==='object'?Array.isArray(value)?value.map(x=>JSON.parse(canonical(x))):Object.fromEntries(Object.keys(value).sort().map(k=>[k,JSON.parse(canonical(value[k]))])):value);
export const semanticCursor=(rows:any[])=>createHash('sha256').update(canonical([...rows].sort((a,b)=>canonical(a).localeCompare(canonical(b))))).digest('hex');
function eventNameInMonth(name:string,sourceMonth:string,targetMonth:string){
 for(const separator of ['_','-']){const prefix=sourceMonth.replace('-',separator)+' - ';if(name.startsWith(prefix))return targetMonth.replace('-',separator)+' - '+name.slice(prefix.length);}
 return name;
}
function eventNameText(name:unknown){return typeof name==='string'?name.replace(/&#(x[0-9a-f]+|[0-9]+);/gi,(match,code)=>{const n=code[0].toLowerCase()==='x'?parseInt(code.slice(1),16):Number(code);return n>31&&n<=0x10ffff&&!(n>=0xd800&&n<=0xdfff)?String.fromCodePoint(n):match;}).normalize('NFC'):'';}
export function servicePolicyPlan(c:any,now=new Date()){
 const p=c.policy,month=c.targetMonth,cursor=p.cursor??{},job=c.job,ms=now.getTime();
 const next=new Date(Math.floor(ms/3600000)*3600000+3600000).toISOString();
 const finish=(state:string,extra:any={})=>({action:'finish',state,nextRunAt:next,cursor,...extra});
 const stop=(code:string)=>finish('REVIEW_REQUIRED',{enabled:false,error:code});
 if(!p||!['MEASUREMENTS','DRI'].includes(p.kind)||!/^20\d{2}-(0[1-9]|1[0-2])$/.test(month))throw Error('INVALID_AUTOMATIC_CONTEXT');
 const enqueue=(kind:string,body:any,stage:string,newCursor:any)=>({action:'enqueue',state:'RUNNING',kind,body:{...body,kind,month,authorizationId:p.authorization_id},cursor:{...newCursor,stage,month},nextRunAt:next});
 if(job){
  if(['QUEUED','RUNNING'].includes(job.state)){if(job.state==='RUNNING'&&job.lease_until&&Date.parse(job.lease_until)<ms)return stop('RESULT_NOT_CONFIRMED');return finish('RUNNING',{nextRunAt:new Date(ms+30000).toISOString(),keepJob:true});}
  if(job.error_code==='BUDGET_EXHAUSTED')return finish('BUDGET_PAUSED',{nextRunAt:new Date(Date.parse(c.today+'T00:00:00-03:00')+86400000).toISOString(),error:'BUDGET_EXHAUSTED'});
  if(job.state!=='SUCCEEDED'||job.result?.complete!==true)return stop(job.error_code??'SOURCE_COVERAGE_REVIEW');
  const rows=job.result?.data?.rows;if(!Array.isArray(rows))return stop('SOURCE_SCHEMA_REVIEW');
  const hash=semanticCursor(p.kind==='DRI'&&cursor.stage==='EVENTS'?rows.map(({providerOccurrences,...r}:any)=>r):rows);
  if(cursor.stage==='MEASUREMENTS')return finish('READY',{success:true,sourceAt:rows.at(-1)?.hourLabel??null,cursor:{month,sourceHash:hash},lastMonthlyDate:c.today,sourceMonth:month});
  if(cursor.stage==='EVENTS'){
   if(cursor.month===month&&cursor.eventsHash===hash)return finish('READY',{sourceMonth:month});
   const expectedName=eventNameInMonth(String(p.source_selector.eventName??''),String(p.month??month).slice(0,7),month);
   const candidates=rows.filter((r:any)=>eventNameText(r.name)===eventNameText(expectedName)&&r.month===month);
   if(!candidates.length)return finish('WAITING_FOR_SOURCE',{cursor:{...cursor,month},sourceMonth:month});
   if(candidates.length!==1)return stop('EVENT_SELECTION_REVIEW');
   return enqueue('DRI_REPORTS',{parentJobId:job.id,eventCode:candidates[0].code},'REPORTS',{...cursor,month,eventCode:candidates[0].code,eventsHash:hash});
  }
  if(cursor.stage==='REPORTS'){
   const monthEnd=new Date(Date.UTC(Number(month.slice(0,4)),Number(month.slice(5,7)),0)).toISOString().slice(0,10);
   const reports=rows.filter((r:any)=>r.name===p.source_selector.reportName&&r.period?.start?.slice(0,10)<=month+'-01'&&(!r.period.end||r.period.end.slice(0,10)>=monthEnd));
   if(reports.length!==1)return stop('REPORT_SELECTION_REVIEW');const frames=reports[0].frames?.filter((f:any)=>f.name===p.source_selector.frameName)??[];
   if(frames.length!==1||!frames[0].parameters?.includes('CODIGO_AGENTE')||frames[0].parameters.some((v:string)=>!['CODIGO_AGENTE','CODIGO_EVENTO_CONTABIL'].includes(v)))return stop('FRAME_SELECTION_REVIEW');
   return enqueue('DRI_RESULTS',{parentJobId:job.id,eventCode:cursor.eventCode,reportId:reports[0].id,frameId:frames[0].id},'RESULTS',cursor);
  }
  if(cursor.stage==='RESULTS')return finish('READY',{success:true,sourceMonth:month,cursor:{month,eventsHash:cursor.eventsHash,sourceHash:hash}});
  return stop('AUTOMATIC_PHASE_REVIEW');
 }
 if(p.kind==='MEASUREMENTS'){
  if(p.month_mode==='PREVIOUS_CLOSED'&&!c.agendaReady)return finish('WAITING_FOR_AGENDA');
  if(p.last_monthly_date===c.today&&cursor.month===month)return finish('READY',{nextRunAt:new Date(Date.parse(c.today+'T00:00:00-03:00')+86400000).toISOString()});
  return enqueue('MEASUREMENTS',{measurementKind:'FINAL'},'MEASUREMENTS',cursor);
 }
 return enqueue('DRI_EVENTS',{},'EVENTS',cursor.month===month?cursor:{});
}
