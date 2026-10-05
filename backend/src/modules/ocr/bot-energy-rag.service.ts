import {BotEnergyLicenseService} from './bot-energy-license.service';
import {Injectable,ForbiddenException,ServiceUnavailableException} from '@nestjs/common';
import {randomUUID} from 'node:crypto';
import {SupabaseService} from '../../services/supabase.service';
import {TenantContext} from '../../common/interfaces/tenant-context.interface';
import {PERMISSIONS as P} from '../../common/constants/permissions';
import {AzureKnowledgeEmbeddingsConnector,KNOWLEDGE_EMBEDDING_MODEL,KNOWLEDGE_EMBEDDING_VERSION} from './azure-knowledge-embeddings.connector';
import {BotEnergyBudgetService} from './bot-energy-budget.service';
import {KnowledgeChunk,KnowledgeQuery,knowledgeEvidence,selectKnowledge} from './bot-energy-knowledge';

@Injectable()
export class BotEnergyRagService {
 constructor(private db:SupabaseService,private embeddings:AzureKnowledgeEmbeddingsConnector,private budget:BotEnergyBudgetService,private licenses:BotEnergyLicenseService){}
 async retrieve(t:TenantContext,question:string,period:Pick<KnowledgeQuery,'periodStart'|'periodEnd'|'market'>){
  if(!t.organizationId||!t.userId||(t.scope as string)==='global'||!t.permissions.includes(P.INTELLIGENCE_AI_USE)||(!['operacional','gestor','admin_org'].includes(t.role)&&t.accessMode!=='platform_operation'))throw new ForbiddenException('Base disponível ao backoffice autorizado.');
  if(!await this.licenses.available(t.organizationId))throw new ForbiddenException('Bot-Energy + RAG exige licença vigente.');
  if(!question.trim()||question.length>500)throw new Error('INVALID_RAG_QUESTION');
  const query={...period,embeddingModel:KNOWLEDGE_EMBEDDING_MODEL,embeddingVersion:KNOWLEDGE_EMBEDDING_VERSION};
  selectKnowledge([],query); // Validate period before any paid call.
  if(!this.embeddings.available(t.organizationId))return {state:'NOT_CONFIGURED',evidence:[],sources:[]};
  // Check a reviewed corpus exists before paying to embed a query.
  const client=this.db.getClient();
  const ready=await client.from('bot_energy_knowledge_versions').select('id').eq('status','REVIEWED').limit(1);
  if(ready.error)throw new ServiceUnavailableException('Banco de conhecimento indisponível.');
  if(!ready.data?.length)return {state:'NO_EVIDENCE',evidence:[],sources:[]};
  const reservation=await this.budget.reserve(t.organizationId,t.userId,randomUUID(),'embeddings',{inputTokens:Buffer.byteLength(question),outputTokens:0},'RAG');
  const embedded=await this.embeddings.embed(t.organizationId,[question]);
  await this.budget.settle(reservation,{inputTokens:embedded.inputTokens,outputTokens:0});
  const {data,error}=await client.rpc('search_bot_energy_knowledge',{p_embedding:JSON.stringify(embedded.vectors[0]),p_period_start:period.periodStart,p_period_end:period.periodEnd,p_market:period.market,p_embedding_model:query.embeddingModel,p_embedding_version:query.embeddingVersion});
  if(error||!Array.isArray(data))throw new ServiceUnavailableException('Não foi possível verificar as normas aplicáveis.');
  const chunks:KnowledgeChunk[]=data.map(c=>({id:c.id,documentId:c.document_id,family:c.family,authority:c.authority,title:c.title,officialUrl:c.official_url,version:c.version,section:c.section,page:c.page,text:c.content,textHash:c.content_hash,documentHash:c.document_hash,validFrom:c.valid_from,validTo:c.valid_to,verifiedAt:c.verified_at,reviewedBy:c.reviewed_by,status:c.status,markets:c.markets,similarity:c.similarity,embeddingModel:c.embedding_model,embeddingVersion:c.embedding_version}));
  const selected=selectKnowledge(chunks,query);
  return {state:selected.state,evidence:selected.chunks.map(knowledgeEvidence),sources:selected.chunks.map(c=>({id:'regulation-'+c.id,title:c.title,section:c.section,url:c.officialUrl,version:c.version,validFrom:c.validFrom,validTo:c.validTo,page:c.page}))};
 }
}
