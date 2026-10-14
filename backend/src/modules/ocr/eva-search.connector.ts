import {Injectable,ServiceUnavailableException} from '@nestjs/common';
import {ConfigService} from '@nestjs/config';
import {ClientSecretCredential} from '@azure/identity';
import {SEARCH_DIMENSIONS,searchDocumentId} from './eva-search.model';
import {exact,hash,uuid} from './eva-extraction.model';
export type SearchIndexedDocument={id:string;chunkId:string;releaseId:string;revisionId:string;contentHash:string;scope:'OFFICIAL_PUBLIC';audience:'PLATFORM';published:boolean;text:string;vector:number[]};
/** Not wired to a worker or chat in 2C1. No user can issue a provider request. */
@Injectable()
export class EvaSearchConnector{
 constructor(private config:ConfigService){}
 private configuration(mode:'QUERY'|'INDEX'){
  if(this.config.get(`EVA_SEARCH_${mode}_CALLS_ENABLED`)!=='true')throw new ServiceUnavailableException('Chamadas Search desligadas.');
  const endpoint=this.config.get<string>('EVA_SEARCH_ENDPOINT')??'',index=this.config.get<string>('EVA_SEARCH_INDEX')??'';
  const tenant=this.config.get<string>('EVA_SEARCH_TENANT_ID')??'',client=this.config.get<string>(`EVA_SEARCH_${mode}_CLIENT_ID`)??'',secret=this.config.get<string>(`EVA_SEARCH_${mode}_CLIENT_SECRET`)??'';
  if(!/^https:\/\/[a-z0-9][a-z0-9-]{1,59}[a-z0-9]\.search\.windows\.net$/.test(endpoint)||!/^eva-official-[a-z0-9][a-z0-9-]{0,60}$/.test(index)||! /^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(tenant)||! /^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(client)||!secret||secret.length>4096)throw new ServiceUnavailableException('Configuração Search incompleta.');
  return {endpoint,index,tenant,client,secret};
 }
 private async request(mode:'QUERY'|'INDEX',suffix:string,body:object){
  const c=this.configuration(mode),signal=AbortSignal.timeout(15000);
  try{
   const token=await new ClientSecretCredential(c.tenant,c.client,c.secret).getToken('https://search.azure.com/.default',{abortSignal:signal});
   if(!token)throw Error();
   const r=await fetch(`${c.endpoint}/indexes/${c.index}/docs/${suffix}?api-version=2024-07-01`,{method:'POST',redirect:'error',signal,headers:{Authorization:`Bearer ${token.token}`,'Content-Type':'application/json'},body:JSON.stringify(body)});
   if(!r.ok||!r.body)throw Error();
   let bytes=0;const parts:Uint8Array[]=[];const reader=r.body.getReader();
   try{for(;;){const x=await reader.read();if(x.done)break;bytes+=x.value.length;if(bytes>2*1024*1024){await reader.cancel();throw Error();}parts.push(x.value);}}finally{reader.releaseLock();}
   return JSON.parse(Buffer.concat(parts).toString('utf8'));
  }catch{throw new ServiceUnavailableException('Resultado Search não confirmado. Preserve a tentativa; sem reenvio automático.');}
 }
 private vector(v:number[]){if(!Array.isArray(v)||v.length!==SEARCH_DIMENSIONS||v.some(x=>!Number.isFinite(x)))throw new ServiceUnavailableException('Vetor inválido.');}
 async index(documents:SearchIndexedDocument[]){
  if(!Array.isArray(documents)||!documents.length||documents.length>100)throw new ServiceUnavailableException('Lote inválido.');
  for(const d of documents){this.vector(d.vector);if(!exact(d,['id','chunkId','releaseId','revisionId','contentHash','scope','audience','published','text','vector'])||!hash(d.id)||!hash(d.chunkId)||!uuid(d.releaseId)||!uuid(d.revisionId)||d.id!==searchDocumentId(d.releaseId,d.chunkId)||!hash(d.contentHash)||d.scope!=='OFFICIAL_PUBLIC'||d.audience!=='PLATFORM'||d.published!==false||typeof d.text!=='string'||Buffer.byteLength(d.text)>20000)throw new ServiceUnavailableException('Documento de índice inválido.');}
  const r=await this.request('INDEX','index',{value:documents.map(d=>({'@search.action':'upload',...d}))});
  if(!r||!Array.isArray(r.value)||r.value.length!==documents.length||r.value.some((x:any)=>!x||!documents.some(d=>d.id===x.key)||x.status!==true)||new Set(r.value.map((x:any)=>x.key)).size!==documents.length)throw new ServiceUnavailableException('Indexação parcial ou divergente.');
  return {confirmedKeys:r.value.map((x:any)=>x.key)};
 }
 async query(question:string,vector:number[],authorizedReleaseId:string){
  this.vector(vector);if(typeof question!=='string'||!question.trim()||question.length>500||! /^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(authorizedReleaseId))throw new ServiceUnavailableException('Consulta inválida.');
  const filter=`releaseId eq '${authorizedReleaseId}' and scope eq 'OFFICIAL_PUBLIC' and audience eq 'PLATFORM' and published eq true`;
  const r=await this.request('QUERY','search',{search:question,filter,vectorFilterMode:'preFilter',vectorQueries:[{kind:'vector',vector,fields:'vector',k:20}],top:10,select:'id,chunkId,releaseId,revisionId,contentHash',queryType:'simple'});
  if(!r||!Array.isArray(r.value)||r.value.length>10||r.value.some((x:any)=>!x||x.releaseId!==authorizedReleaseId||!uuid(x.revisionId)||!hash(x.id)||!hash(x.chunkId)||x.id!==searchDocumentId(authorizedReleaseId,x.chunkId)||!hash(x.contentHash)||!Number.isFinite(x['@search.score'])||x['@search.score']<0)||new Set(r.value.map((x:any)=>x.id)).size!==r.value.length)throw new ServiceUnavailableException('Evidência Search divergente.');
  return r.value.map((x:any)=>({id:x.chunkId,indexId:x.id,revisionId:x.revisionId,contentHash:x.contentHash,ranking:'RRF' as const,score:x['@search.score']}));
 }
}
