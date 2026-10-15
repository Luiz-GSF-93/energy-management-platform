import {BadRequestException,ConflictException,ForbiddenException,Injectable,ServiceUnavailableException} from '@nestjs/common';
import {ConfigService} from '@nestjs/config';
import {randomUUID} from 'node:crypto';
import {SupabaseService} from '../../services/supabase.service';
import {EvaSearchConnector,SearchIndexedDocument} from './eva-search.connector';
import {EvaSearchEmbeddingConnector} from './eva-search-embedding.connector';
import {exact,hash,uuid,justification,digest} from './eva-extraction.model';
import {CompositeCandidate,CompositeChunk,compositeFilters,compositePrepareCommand,prepareComposite} from './eva-composite.model';
import {searchDocumentId} from './eva-search.model';
import {corpusRemoteMatches} from './eva-corpus.model';

export type CompositeClaim={id:string;batchId:string;leaseId:string;releaseId:string;revisionId:string;phase:'INDEX'|'PUBLISH';readOnly:boolean;chunks:(CompositeChunk&{vector:number[]|null})[]};
@Injectable()
export class EvaCompositeService{
 constructor(private db:SupabaseService,private config:ConfigService,private search:EvaSearchConnector,private embeddings:EvaSearchEmbeddingConnector){}
 private async rpc(actor:string,action:string,id:string|null,body:unknown){
  if(this.config.get('EVA_COMPOSITE_PUBLICATION_ENABLED')!=='true')throw new ServiceUnavailableException('Publicação composta desligada; aguardando homologação.');
  let r:any;try{r=await this.db.getClient().rpc('eva_composite_action',{p_actor:actor,p_action:action,p_release:id,p_body:body});}catch{throw new ServiceUnavailableException('Resultado não confirmado. Confira o histórico antes de repetir.');}
  if(r.error){if(r.error.code==='42501')throw new ForbiddenException('Acesso exclusivo do perfil autorizado; revisão independente obrigatória.');if(r.error.code==='23505')throw new ConflictException('Conjunto, revisão ou execução alterados. Reconfira o histórico.');if(['22023','22P02','23514','22003'].includes(r.error.code))throw new BadRequestException('Plano, evidências ou limites inválidos.');throw new ServiceUnavailableException('Resultado não confirmado. Preserve a tentativa.');}return r.data;
 }
 list(actor:string,q:Record<string,unknown>,candidates=false){let filter;try{filter=compositeFilters(q);}catch{throw new BadRequestException('Filtros inválidos.');}return this.rpc(actor,candidates?'candidates':'list',null,filter);}
 detail(actor:string,id:string,q:Record<string,unknown>){if(!uuid(id)||!exact(q,['page','batchPage'])||Object.values(q).some(x=>typeof x!=='string'||!/^\d{1,3}$/.test(x)))throw new BadRequestException('Paginação inválida.');return this.rpc(actor,'detail',id,{page:Number(q.page),batchPage:Number(q.batchPage)});}
 preview(actor:string,id:string,q:Record<string,unknown>){if(!uuid(id)||!exact(q,['page'])||typeof q.page!=='string'||!/^\d{1,3}$/.test(q.page))throw new BadRequestException('Paginação inválida.');return this.rpc(actor,'preview',id,{page:Number(q.page)});}
 metrics(actor:string,q:Record<string,unknown>){if(!exact(q,['month'])||typeof q.month!=='string'||!/^(20|21)\d{2}-(0[1-9]|1[0-2])$/.test(q.month))throw new BadRequestException('Competência inválida.');return this.rpc(actor,'metrics',null,q);}
 async prepare(actor:string,body:unknown){
  if(!compositePrepareCommand(body))throw new BadRequestException('Confira o conjunto e a justificativa.');
  const source:CompositeCandidate=await this.rpc(actor,'candidate',body.setId,{});
  if(source.manifestHash!==body.expectedManifestHash)throw new ConflictException('Manifesto alterado.');
  let plan;try{plan=prepareComposite(source);}catch{throw new BadRequestException('Conjunto incompleto, aplicabilidade divergente ou seção acima dos limites. Conclua a curadoria.');}
  return this.rpc(actor,'prepare',null,{...body,...plan});
 }
 async command(actor:string,id:string,action:string,body:unknown){
  const common=['requestId','expectedEventId','justification'],extra=action==='index'?['batchId','tokenLimit']:['publish','reconcile'].includes(action)?['batchId']:[];
  if(!uuid(id)||!['review','quarantine','index','publish','reconcile'].includes(action)||!exact(body,[...common,...extra])||!uuid(body.requestId)||!uuid(body.expectedEventId)||!justification(body.justification)||extra.includes('batchId')&&!uuid(body.batchId)||action==='index'&&(!Number.isSafeInteger(body.tokenLimit)||body.tokenLimit<1||body.tokenLimit>1000000))throw new BadRequestException('Comando ou limite inválido.');
  if(['review','quarantine'].includes(action))return this.rpc(actor,action,id,body);
  if(this.config.get('EVA_COMPOSITE_CALLS_ENABLED')!=='true'||this.config.get('EVA_SEARCH_INDEX_CALLS_ENABLED')!=='true'||this.config.get('EVA_SEARCH_INDEX')!=='eva-official-pilot-v1'||action==='index'&&this.config.get('EVA_SEARCH_EMBEDDING_CALLS_ENABLED')!=='true')throw new ServiceUnavailableException('Chamadas externas compostas desligadas.');
  const plan=action==='reconcile'?body:{...body,phase:action==='index'?'INDEX':'PUBLISH',tokenLimit:action==='index'?body.tokenLimit:null};
  const claim:CompositeClaim&{replayed?:boolean}=await this.rpc(actor,action==='reconcile'?'reconcile':'claim',id,plan);
  if(claim.replayed)return claim;
  void this.perform(actor,claim).catch(()=>{/* The durable lease stays uncertain; no automatic resend. */});
  return {id,queued:true,published:false};
 }
 private send(actor:string,c:CompositeClaim,kind:string,chunkId:string){return this.rpc(actor,'send',c.id,{requestId:randomUUID(),batchId:c.batchId,leaseId:c.leaseId,kind,chunkId});}
 private validVector(v:unknown):v is number[]{return Array.isArray(v)&&v.length===1536&&v.every(n=>typeof n==='number'&&Number.isFinite(n)&&Math.abs(n)<=1)&&v.some(n=>n!==0);}
 /** A single explicitly claimed batch. Recovery is GET-only and never regenerates a lost vector. */
 async perform(actor:string,c:CompositeClaim){
  const started=Date.now();let confirmed=false;
  try{
   if(!c||![c.id,c.batchId,c.leaseId,c.releaseId,c.revisionId].every(uuid)||c.id!==c.releaseId||!['INDEX','PUBLISH'].includes(c.phase)||typeof c.readOnly!=='boolean'||!Array.isArray(c.chunks)||c.chunks.length<1||c.chunks.length>100)throw Error();
   for(const x of c.chunks)if(!hash(x.id)||!hash(x.textHash)||typeof x.text!=='string'||x.text.length>6000||Buffer.byteLength(x.text)>16000||digest(x.text)!==x.textHash||((c.readOnly||c.phase==='PUBLISH')&&!this.validVector(x.vector)))throw Error();
   if(c.phase==='INDEX'&&!c.readOnly){
    for(const x of c.chunks){
     await this.send(actor,c,'EMBEDDING',x.id);const embedded=await this.embeddings.embed(x.text);
     if(!this.validVector(embedded.vector))throw Error();
     await this.rpc(actor,'embedded',c.id,{requestId:randomUUID(),batchId:c.batchId,leaseId:c.leaseId,chunkId:x.id,vector:embedded.vector,tokens:embedded.tokens});x.vector=embedded.vector;
    }
    const docs:SearchIndexedDocument[]=c.chunks.map(x=>({id:searchDocumentId(c.releaseId,x.id),chunkId:x.id,releaseId:c.releaseId,revisionId:c.revisionId,contentHash:x.textHash,scope:'OFFICIAL_PUBLIC',audience:'PLATFORM',published:false,text:x.text,vector:x.vector!}));
    for(const x of c.chunks)await this.send(actor,c,'INDEX',x.id);await this.search.index(docs);
   }
   for(const x of c.chunks){
    const matches=(remote:unknown,published:boolean)=>corpusRemoteMatches({id:c.id,releaseId:c.releaseId,revisionId:c.revisionId,leaseId:c.leaseId,readOnly:c.readOnly,chunks:[]},{id:x.id,text:x.text,contentHash:x.textHash,vector:x.vector!},remote,published);
    if(c.phase==='PUBLISH'&&!c.readOnly){
     await this.send(actor,c,'LOOKUP_BEFORE',x.id);if(!matches(await this.search.lookup(searchDocumentId(c.releaseId,x.id)),false))throw Error();
     await this.send(actor,c,'MERGE',x.id);await this.search.publish(c.releaseId,x.id);
    }
    await this.send(actor,c,'LOOKUP_AFTER',x.id);if(!matches(await this.search.lookup(searchDocumentId(c.releaseId,x.id)),c.phase==='PUBLISH'))throw Error();
    await this.rpc(actor,'verified',c.id,{requestId:randomUUID(),batchId:c.batchId,leaseId:c.leaseId,chunkId:x.id});
   }
   confirmed=true;
  }catch{/* Partial or unknown provider effects remain private and require explicit read-only recovery. */}
  return this.rpc(actor,'finish',c.id,{requestId:randomUUID(),batchId:c.batchId,leaseId:c.leaseId,confirmed,elapsedMs:Math.min(3600000,Math.max(0,Date.now()-started))});
 }
}
