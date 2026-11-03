import {createHash} from 'node:crypto';
export type DriIdentityDiagnostic={version:1;stage:'EVENT_IDENTITY';eventCode:string;sourceHashes:string[];changedPaths:string[];truncated:boolean};
export type DriHeaderDiagnostic={version:1;stage:'RESULT_HEADERS';eventCode:string;reportId:string;frameId:string;sourceHashes:string[];headers:string[];truncated:boolean};
export type DriDiagnostic=DriIdentityDiagnostic|DriHeaderDiagnostic;
const sensitive=/password|senha|secret|token|pfx|private|credential|username|usuario|authorization/i;
/** Column names only, never cells. Redact identifiers, links and credential-like labels. */
export function driHeaderDiagnostic(eventCode:string,reportId:string,frameId:string,columns:string[],sourceHash:string):DriHeaderDiagnostic{
 let truncated=columns.length>24;
 const headers=columns.slice(0,24).map(value=>{
  const name=value.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toUpperCase().trim();
  if(name.length>160||sensitive.test(name)||/\d{7,}|HTTPS?:|WWW\./.test(name)||! /^[A-Z0-9 _().,/%:+&#;$=\-]{1,160}$/.test(name)){truncated=true;return 'CABECALHO_PROTEGIDO';}
  return name;
 });
 return{version:1,stage:'RESULT_HEADERS',eventCode,reportId,frameId,sourceHashes:[sourceHash],headers,truncated};
}
const canonical=(x:any):any=>Array.isArray(x)?x.map(canonical):x&&typeof x==='object'?Object.fromEntries(Object.keys(x).sort().map(k=>[k,canonical(x[k])])):x;
/** Metadata paths and hashes only. Never return XML, credentials or field values. */
export function driIdentityDiagnostic(eventCode:string,before:unknown,after:unknown):DriIdentityDiagnostic{
 const changedPaths:string[]=[];let truncated=false;
 const push=(path:string)=>{if(path.length>240){path='profundidadeLimitada';truncated=true;}if(changedPaths.length<16){if(!changedPaths.includes(path))changedPaths.push(path);}else truncated=true;};
 const walk=(a:any,b:any,path:string,depth:number)=>{
  if(JSON.stringify(a)===JSON.stringify(b))return;
  if(depth>12){truncated=true;push(path||'raiz');return;}
  if(a&&b&&typeof a==='object'&&typeof b==='object'&&Array.isArray(a)===Array.isArray(b)){
   for(const key of [...new Set([...Object.keys(a),...Object.keys(b)])].sort()){
    if(sensitive.test(key)){if(JSON.stringify(a[key])!==JSON.stringify(b[key]))push('campoProtegido');continue;}
    if(!/^[A-Za-z0-9_]{1,80}$/.test(key)){push('campoNaoRepresentavel');continue;}
    walk(a[key],b[key],path?path+'.'+key:key,depth+1);
   }
  }else push(path||'raiz');
 };
 walk(before,after,'',0);
 return{version:1,stage:'EVENT_IDENTITY',eventCode,sourceHashes:[before,after].map(x=>createHash('sha256').update(JSON.stringify(canonical(x))).digest('hex')),changedPaths,truncated};
}
