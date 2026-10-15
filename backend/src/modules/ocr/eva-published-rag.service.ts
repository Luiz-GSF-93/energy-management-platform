import {Injectable,ServiceUnavailableException} from '@nestjs/common';
import {ConfigService} from '@nestjs/config';
import {randomUUID} from 'node:crypto';
import {SupabaseService} from '../../services/supabase.service';
import {TenantContext} from '../../common/interfaces/tenant-context.interface';
import {EvaSearchConnector} from './eva-search.connector';
import {EvaSearchEmbeddingConnector} from './eva-search-embedding.connector';
import {BotEnergyBudgetService,usageCost} from './bot-energy-budget.service';
import {CorpusProof,corpusCceeQuestion,corpusVersionConflict,validateCorpusSources} from './eva-corpus.model';
import {KnowledgeQuery,knowledgeTextHash} from './bot-energy-knowledge';

export type PublishedRagResult={state:string;evidence:{id:string;label:string;value:string;source:string}[];sources:{id:string;title:string;section:string;url:string;version:string;validFrom:string;validTo:string|null;page:number|null}[];publicationProofs?:CorpusProof[]};
@Injectable()
export class EvaPublishedRagService{
 private active=0;
 private readonly windows=new Map<string,{start:number;count:number}>();
 constructor(private db:SupabaseService,private config:ConfigService,private search:EvaSearchConnector,private embeddings:EvaSearchEmbeddingConnector,private budget:BotEnergyBudgetService){}
 enabledFor(t:TenantContext){return this.config.get('EVA_SEARCH_RAG_ENABLED')==='true'&&t.organizationId==='org_default'&&t.role!=='consulta'&&String(this.config.get('EVA_SEARCH_RAG_ORGANIZATIONS')??'').split(',').map(s=>s.trim()).includes('org_default');}
 private async rpc(t:TenantContext,action:string,body:unknown){
  const r=await this.db.getClient().rpc(this.config.get('EVA_COMPOSITE_RAG_ENABLED')==='true'?'eva_composite_rag':'eva_corpus_rag',{p_actor:t.userId,p_org:t.organizationId,p_role:t.roleId,p_operation:t.accessMode==='platform_operation',p_action:action,p_body:body});
  if(r.error)throw new ServiceUnavailableException('Biblioteca oficial indisponível ou alterada; reconfira as fontes.');return r.data;
 }
 async revalidate(t:TenantContext,proofs:CorpusProof[]){
  if(!this.enabledFor(t)||!Array.isArray(proofs)||!proofs.length)throw new ServiceUnavailableException('Publicação oficial indisponível.');
  const r=await this.rpc(t,'revalidate',{proofs});if(r?.valid!==true)throw new ServiceUnavailableException('Publicação oficial alterada.');
 }
 async retrieve(t:TenantContext,question:string,q:Pick<KnowledgeQuery,'periodStart'|'periodEnd'|'market'>):Promise<PublishedRagResult>{
  const empty=(state:string):PublishedRagResult=>({state,evidence:[],sources:[]});
  if(!this.enabledFor(t)||this.config.get('EVA_SEARCH_QUERY_CALLS_ENABLED')!=='true'||this.config.get('EVA_SEARCH_EMBEDDING_CALLS_ENABLED')!=='true'||this.config.get('EVA_SEARCH_INDEX')!=='eva-official-pilot-v1')return empty('NOT_CONFIGURED');
  if(typeof question!=='string'||!question.trim()||question.length>500)throw new ServiceUnavailableException('Consulta inválida.');
  if(q.market==='COMMON'&&corpusCceeQuestion(question))q={...q,market:'ACL'};
  validateCorpusSources([],q);
  const sources=validateCorpusSources(await this.rpc(t,'sources',{from:q.periodStart,to:q.periodEnd,market:q.market}),q,this.config.get('EVA_COMPOSITE_RAG_ENABLED')==='true');
  if(!sources.length)return empty('NO_EVIDENCE');if(corpusVersionConflict(sources,q))return empty('VERSION_CONFLICT');
  const proofs=sources.map(s=>({publicationId:s.publicationId,eventId:s.publicationEventId,...(s.kind==='COMPOSITE'?{kind:'COMPOSITE' as const}:{})}));
  const now=Date.now(),key=t.organizationId+'|'+t.userId;
  for(const [k,v] of this.windows)if(now-v.start>=60000)this.windows.delete(k);
  const window=this.windows.get(key)??{start:now,count:0};
  if(this.active>=8||window.count>=6||this.windows.size>=10000&&!this.windows.has(key))throw new ServiceUnavailableException('Aguarde antes de consultar novamente.');
  window.count++;this.windows.set(key,window);this.active++;
  const started=Date.now(),requestId=randomUUID();let audited=false,tokens=0,cost:number|null=null,requests=0,state='FAILED';
  try{
   await this.rpc(t,'begin',{requestId,proofs});audited=true;
   // Same request ID ties the retrieval audit to the existing quota/cost ledger.
   const reservation=await this.budget.reserve(t.organizationId,t.userId,requestId,'embeddings',{inputTokens:Buffer.byteLength(question),outputTokens:0},'RAG');
   const embedded=await this.embeddings.embed(question);tokens=embedded.tokens;
   await this.budget.settle(reservation,{inputTokens:tokens,outputTokens:0});cost=usageCost({inputTokens:tokens,outputTokens:0},reservation.prices.input,reservation.prices.output);
   const hits=await Promise.all(sources.map(async s=>{requests++;return (await this.search.query(question,embedded.vector,s.releaseId)).filter(h=>h.score>0).map(h=>({releaseId:s.releaseId,chunkId:h.id,revisionId:h.revisionId,contentHash:h.contentHash,score:h.score}));}));
   const ranked=hits.flat().sort((a,b)=>b.score-a.score||a.releaseId.localeCompare(b.releaseId)||a.chunkId.localeCompare(b.chunkId));
   const hydrated=await this.rpc(t,'hydrate',{proofs,hits:ranked.map(({score,...h})=>h)});
   if(!Array.isArray(hydrated)||hydrated.length!==ranked.length)throw Error();
   const rows=hydrated.map((r:any,i:number)=>{
    const h=ranked[i],s=sources.find(x=>x.releaseId===h.releaseId);
    if(!s||r.releaseId!==s.releaseId||r.revisionId!==s.revisionId||r.chunkId!==h.chunkId||r.textHash!==h.contentHash||typeof r.text!=='string'||!r.text.trim()||r.text.length>6000||knowledgeTextHash(r.text)!==h.contentHash||typeof r.heading!=='string'||typeof r.context!=='string'||(r.page!==null&&(!Number.isInteger(r.page)||r.page<1||s.kind==='COMPOSITE'&&r.page>s.originalPages!)))throw Error();
    // Metadata comes from the live reviewed source, never from the provider response.
    return {s,r};
   }).slice(0,6);
   state=rows.length?'READY':'NO_EVIDENCE';
   const evidence=rows.map(({s,r})=>({id:'regulation-'+s.releaseId+'-'+r.chunkId,label:s.title+' · '+r.heading,value:r.text,source:`${s.authority} · versão ${s.version} · vigência ${s.validFrom} até ${s.validTo??'sem término cadastrado'} · página ${r.page??'não paginada'} · aplicabilidade: ${s.topic} · contexto: ${r.context} · hash ${s.fileHash}`}));
   const citations=rows.map(({s,r},i)=>({id:evidence[i].id,title:s.title,section:r.heading,url:s.url,version:s.version,validFrom:s.validFrom,validTo:s.validTo,page:r.page}));
   return {state,evidence,sources:citations,...(rows.length?{publicationProofs:proofs}:{})};
  }catch{throw new ServiceUnavailableException('Não foi possível conferir as evidências oficiais. Nenhuma resposta normativa foi liberada.');}
  finally{
   try{if(audited)await this.rpc(t,'finish',{requestId,eventId:randomUUID(),state,elapsedMs:Math.min(3600000,Math.max(0,Date.now()-started)),inputTokens:tokens,searchRequests:requests,embeddingCostMicroUsd:cost});}finally{this.active--;}
  }
 }
}
