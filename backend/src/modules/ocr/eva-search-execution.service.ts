import {BadRequestException,ConflictException,ForbiddenException,Injectable,ServiceUnavailableException} from '@nestjs/common';
import {ConfigService} from '@nestjs/config';
import {randomUUID} from 'node:crypto';
import {SupabaseService} from '../../services/supabase.service';
import {exact,uuid,justification} from './eva-extraction.model';
import {EvaSearchConnector,SearchIndexedDocument} from './eva-search.connector';
import {EvaSearchEmbeddingConnector} from './eva-search-embedding.connector';
import {searchDocumentId} from './eva-search.model';
type Claim={id:string;releaseId:string;revisionId:string;leaseId:string;indexName:string;tokenLimit:number;chunks:{id:string;text:string;contentHash:string;vector:number[]|null}[]};
@Injectable()
export class EvaSearchExecutionService{
 constructor(private db:SupabaseService,private config:ConfigService,private search:EvaSearchConnector,private embeddings:EvaSearchEmbeddingConnector){}
 private enabled(){if(this.config.get('EVA_SEARCH_EXECUTION_ENABLED')!=='true')throw new ServiceUnavailableException('Execução privada Search desligada.');}
 private async rpc(actor:string,action:string,id:string|null,body:unknown){
  this.enabled();let r:any;try{r=await this.db.getClient().rpc('eva_search_execution_action',{p_actor:actor,p_action:action,p_command:id,p_body:body});}catch{throw new ServiceUnavailableException('Comando não confirmado; reconfira.');}
  if(r.error){if(r.error.code==='42501')throw new ForbiddenException('Acesso de execução restrito.');if(r.error.code==='23505')throw new ConflictException('Comando, orçamento ou fonte alterados; reconfira.');if(['22023','22P02','23514','23502'].includes(r.error.code))throw new BadRequestException('Confira identificadores, limites e justificativa.');throw new ServiceUnavailableException('Comando não confirmado; reconfira.');}return r.data;
 }
 list(actor:string,q:Record<string,unknown>){if(!exact(q,['page','state'])||!/^\d{1,3}$/.test(String(q.page))||!['','PREPARED','RUNNING','UNKNOWN','SUCCEEDED','WITHDRAWN'].includes(String(q.state)))throw new BadRequestException('Filtros inválidos.');return this.rpc(actor,'list',null,{page:Number(q.page),state:q.state});}
 detail(actor:string,id:string,q:Record<string,unknown>){if(!uuid(id)||!exact(q,['page'])||!/^\d{1,3}$/.test(String(q.page)))throw new BadRequestException('Consulta inválida.');return this.rpc(actor,'detail',id,{page:Number(q.page)});}
 metrics(actor:string,q:Record<string,unknown>){if(!exact(q,['month'])||typeof q.month!=='string'||!/^(20|21)\d{2}-(0[1-9]|1[0-2])$/.test(q.month))throw new BadRequestException('Competência inválida.');return this.rpc(actor,'metrics',null,q);}
 prepare(actor:string,b:unknown){if(!exact(b,['requestId','releaseId','expectedReleaseEventId','tokenLimit','justification'])||!uuid(b.requestId)||!uuid(b.releaseId)||!uuid(b.expectedReleaseEventId)||!Number.isSafeInteger(b.tokenLimit)||Number(b.tokenLimit)<1||Number(b.tokenLimit)>1000000||!justification(b.justification))throw new BadRequestException('Preparação inválida.');return this.rpc(actor,'prepare',b.requestId,b);}
 async command(actor:string,id:string,action:string,b:unknown){
  if(!uuid(id)||!['withdraw','execute','reconcile'].includes(action)||!exact(b,['requestId','expectedEventId','justification'])||!uuid(b.requestId)||!uuid(b.expectedEventId)||!justification(b.justification))throw new BadRequestException('Comando inválido.');
  if(action==='withdraw')return this.rpc(actor,'withdraw',id,b);
  // Before reserving, fail closed on every provider flag and the exact configured index.
  if(this.config.get('EVA_SEARCH_EXECUTION_CALLS_ENABLED')!=='true'||this.config.get('EVA_SEARCH_INDEX')!=='eva-official-pilot-v1'||this.config.get('EVA_SEARCH_INDEX_CALLS_ENABLED')!=='true'||(action==='execute'&&this.config.get('EVA_SEARCH_EMBEDDING_CALLS_ENABLED')!=='true'))throw new ServiceUnavailableException('Chamadas de execução desligadas ou configuração incompleta.');
  const claim:Claim=await this.rpc(actor,action==='execute'?'claim':'reconcile',id,b);
  void this.perform(actor,claim,action==='reconcile').catch(()=>{/* The persisted lease remains ambiguous if recording itself failed. Never resend. */});
  return {id,queued:true,published:false};
 }
 private send(actor:string,c:Claim,kind:string,chunkId:string,reservedTokens=0){return this.rpc(actor,'send',c.id,{leaseId:c.leaseId,requestId:randomUUID(),kind,chunkId,reservedTokens});}
 /** One persisted lease; no scheduled retries, no publication, no generation call. */
 async perform(actor:string,c:Claim,readOnly:boolean){
  const started=Date.now();
  let reason='PROVIDER_UNKNOWN',confirmed=true;
  try{
   if(!c||c.indexName!=='eva-official-pilot-v1'||!Array.isArray(c.chunks)||!c.chunks.length||c.chunks.length>100)throw Error();
   for(const chunk of c.chunks){
    if(!readOnly){
     await this.send(actor,c,'EMBEDDING',chunk.id,Buffer.byteLength(chunk.text));
     const embedded=await this.embeddings.embed(chunk.text);
     await this.rpc(actor,'embedded',c.id,{leaseId:c.leaseId,chunkId:chunk.id,vector:embedded.vector,tokens:embedded.tokens});
     chunk.vector=embedded.vector;
     const doc:SearchIndexedDocument={id:searchDocumentId(c.releaseId,chunk.id),chunkId:chunk.id,releaseId:c.releaseId,revisionId:c.revisionId,contentHash:chunk.contentHash,scope:'OFFICIAL_PUBLIC',audience:'PLATFORM',published:false,text:chunk.text,vector:embedded.vector};
     await this.send(actor,c,'INDEX',chunk.id);await this.search.index([doc]);
    }
    // Recovery only reads. Missing/divergent entries never authorize another POST.
    await this.send(actor,c,'LOOKUP',chunk.id);
    const remote=await this.search.lookup(searchDocumentId(c.releaseId,chunk.id));
    if(!remote||!chunk.vector||remote.id!==searchDocumentId(c.releaseId,chunk.id)||remote.chunkId!==chunk.id||remote.releaseId!==c.releaseId||remote.revisionId!==c.revisionId||remote.contentHash!==chunk.contentHash||remote.scope!=='OFFICIAL_PUBLIC'||remote.audience!=='PLATFORM'||remote.published!==false||remote.text!==chunk.text||!Array.isArray(remote.vector)||remote.vector.length!==1536||remote.vector.some((v:number,i:number)=>!Number.isFinite(v)||Math.abs(v-chunk.vector![i])>0.000001)){confirmed=false;reason='MISSING_OR_DIVERGENT';break;}
    await this.rpc(actor,'verified',c.id,{leaseId:c.leaseId,requestId:randomUUID(),chunkId:chunk.id});
   }
   if(confirmed)reason='CONFIRMED';
  }catch{confirmed=false;}
  return this.rpc(actor,'finish',c.id,{leaseId:c.leaseId,requestId:randomUUID(),state:confirmed?'SUCCEEDED':'UNKNOWN',reason,elapsedMs:Math.min(3600000,Math.max(0,Date.now()-started))});
 }
}
