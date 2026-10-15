import {BadRequestException,ConflictException,ForbiddenException,Injectable,ServiceUnavailableException} from '@nestjs/common';
import {ConfigService} from '@nestjs/config';
import {randomUUID} from 'node:crypto';
import {SupabaseService} from '../../services/supabase.service';
import {exact,uuid,justification} from './eva-extraction.model';
import {EvaSearchConnector} from './eva-search.connector';
import {searchDocumentId} from './eva-search.model';
import {CorpusClaim,corpusRemoteMatches} from './eva-corpus.model';

@Injectable()
export class EvaCorpusPublicationService{
 constructor(private db:SupabaseService,private config:ConfigService,private search:EvaSearchConnector){}
 private async rpc(actor:string,action:string,id:string|null,body:unknown){
  if(this.config.get('EVA_CORPUS_PUBLICATION_ENABLED')!=='true')throw new ServiceUnavailableException('Publicação do corpus desligada.');
  let r:any;try{r=await this.db.getClient().rpc('eva_corpus_action',{p_actor:actor,p_action:action,p_publication:id,p_body:body});}catch{throw new ServiceUnavailableException('Resultado não confirmado; confira o histórico antes de repetir.');}
  if(r.error){if(r.error.code==='42501')throw new ForbiddenException('Acesso restrito.');if(r.error.code==='23505')throw new ConflictException('Fonte ou publicação alterada; reconfira.');if(['22023','22P02','23514','23502'].includes(r.error.code))throw new BadRequestException('Confira os campos e a justificativa.');throw new ServiceUnavailableException('Resultado não confirmado; confira o histórico antes de repetir.');}return r.data;
 }
 list(actor:string,q:Record<string,unknown>){if(!exact(q,['page','state','search'])||!/^\d{1,3}$/.test(String(q.page))||!['','PREPARED','PUBLISHING','UNKNOWN','ACTIVE','QUARANTINED'].includes(String(q.state))||typeof q.search!=='string'||q.search.length>100)throw new BadRequestException('Filtros inválidos.');return this.rpc(actor,'list',null,{page:Number(q.page),state:q.state,search:q.search});}
 detail(actor:string,id:string,q:Record<string,unknown>){if(!uuid(id)||!exact(q,['page'])||!/^\d{1,3}$/.test(String(q.page)))throw new BadRequestException('Consulta inválida.');return this.rpc(actor,'detail',id,{page:Number(q.page)});}
 metrics(actor:string,q:Record<string,unknown>){if(!exact(q,['month'])||typeof q.month!=='string'||!/^(20|21)\d{2}-(0[1-9]|1[0-2])$/.test(q.month))throw new BadRequestException('Competência inválida.');return this.rpc(actor,'metrics',null,q);}
 prepare(actor:string,b:unknown){if(!exact(b,['requestId','releaseId','expectedReleaseEventId','justification'])||!uuid(b.requestId)||!uuid(b.releaseId)||!uuid(b.expectedReleaseEventId)||!justification(b.justification))throw new BadRequestException('Preparação inválida.');return this.rpc(actor,'prepare',b.requestId,b);}
 async command(actor:string,id:string,action:string,b:unknown){
  if(!uuid(id)||!['publish','reconcile','quarantine'].includes(action)||!exact(b,['requestId','expectedEventId','justification'])||!uuid(b.requestId)||!uuid(b.expectedEventId)||!justification(b.justification))throw new BadRequestException('Comando inválido.');
  if(action==='quarantine')return this.rpc(actor,action,id,b);
  if(this.config.get('EVA_CORPUS_PUBLICATION_CALLS_ENABLED')!=='true'||this.config.get('EVA_SEARCH_INDEX_CALLS_ENABLED')!=='true'||this.config.get('EVA_SEARCH_INDEX')!=='eva-official-pilot-v1')throw new ServiceUnavailableException('Chamadas externas de publicação desligadas.');
  const claim:CorpusClaim=await this.rpc(actor,action,id,b);
  // A replay of an accepted request must never restart its external operation.
  if(claim&&'replayed' in claim)return claim;
  void this.perform(actor,claim).catch(()=>{/* Persisted lease remains uncertain. No automatic retry. */});return {id,queued:true};
 }
 async perform(actor:string,c:CorpusClaim){
  let confirmed=false;
  try{
   if(!c||!uuid(c.id)||!uuid(c.releaseId)||!uuid(c.revisionId)||!uuid(c.leaseId)||typeof c.readOnly!=='boolean'||!Array.isArray(c.chunks)||!c.chunks.length||c.chunks.length>100)throw Error();
   for(const x of c.chunks){
    const send=(kind:string)=>this.rpc(actor,'send',c.id,{leaseId:c.leaseId,requestId:randomUUID(),kind,chunkId:x.id});
    await send('LOOKUP');const before=await this.search.lookup(searchDocumentId(c.releaseId,x.id));
    if(!corpusRemoteMatches(c,x,before,c.readOnly))throw Error();
    if(!c.readOnly){await send('MERGE');await this.search.publish(c.releaseId,x.id);await send('LOOKUP');if(!corpusRemoteMatches(c,x,await this.search.lookup(searchDocumentId(c.releaseId,x.id)),true))throw Error();}
    await this.rpc(actor,'verified',c.id,{leaseId:c.leaseId,requestId:randomUUID(),chunkId:x.id});
   }
   confirmed=true;
  }catch{/* Unknown results remain denied to the chat; recovery is GET only. */}
  return this.rpc(actor,'finish',c.id,{leaseId:c.leaseId,requestId:randomUUID(),confirmed});
 }
}
