import {Injectable,ForbiddenException,ServiceUnavailableException} from '@nestjs/common';
import {randomUUID} from 'node:crypto';
import {SupabaseService} from '../../services/supabase.service';
import {TenantContext} from '../../common/interfaces/tenant-context.interface';
import {PERMISSIONS as P} from '../../common/constants/permissions';
import {BotEnergyBudgetService} from './bot-energy-budget.service';
import {AzureKnowledgeEmbeddingsConnector,KNOWLEDGE_EMBEDDING_MODEL,KNOWLEDGE_EMBEDDING_VERSION} from './azure-knowledge-embeddings.connector';
import {KnowledgeAuthority,KnowledgeFamily,EnergyMarket,officialKnowledgeUrl,knowledgeTextHash,knowledgeCatalogue} from './bot-energy-knowledge';

export type RegulatorySource={documentKey:string;family:KnowledgeFamily;authority:KnowledgeAuthority;title:string;version:string;officialUrl:string;documentHash:string;publishedAt:string;validFrom:string;validTo:string|null;markets:EnergyMarket[];pages:{page:number|null;section:string;text:string}[]};
export function authorizedKnowledgeIndexer(t:TenantContext){
 return !!t.organizationId&&!!t.userId&&(t.scope as string)!=='global'&&
  (['gestor','admin_org'].includes(t.role)||(t.role==='admin_platform'&&t.scope==='organization'&&t.accessMode==='platform_operation'))&&
  t.permissions.includes(P.INTELLIGENCE_AI_USE);
}
export function regulatoryChunks(pages:RegulatorySource['pages']){
 const rows:{ordinal:number;section:string;page:number|null;content:string;content_hash:string}[]=[];
 for(const page of pages){
  if(!page.section.trim()||page.section.length>500||!page.text.trim()||page.page!==null&&(!Number.isInteger(page.page)||page.page<1))throw new Error('INVALID_REGULATORY_PAGE');
  // Keep every source character; deterministic boundaries and page/section provenance.
  const text=page.text.replace(/\r\n/g,'\n').trim();
  for(let offset=0;offset<text.length;offset+=2800){const content=text.slice(offset,offset+2800);rows.push({ordinal:rows.length,section:page.section,page:page.page,content,content_hash:knowledgeTextHash(content)});}
 }
 if(!rows.length||rows.length>20000)throw new Error('INVALID_REGULATORY_CORPUS');
 return rows;
}
// Internal ingestion: never exposed to documents/users as a public upload endpoint.
// A downloaded portal is discovery, not a norm. Content must be parsed from the official file.
@Injectable()
export class BotEnergyKnowledgeIndexService {
 constructor(private db:SupabaseService,private embeddings:AzureKnowledgeEmbeddingsConnector,private budget:BotEnergyBudgetService){}
 async index(t:TenantContext,source:RegulatorySource){
  if(!authorizedKnowledgeIndexer(t))throw new ForbiddenException('Indexação exige gestor autorizado ou operação de plataforma em organização selecionada.');
  if(!knowledgeCatalogue.some(c=>c.family===source.family&&c.authority===source.authority)||!officialKnowledgeUrl(source.authority,source.officialUrl)||!/^[a-f0-9]{64}$/.test(source.documentHash))throw new Error('UNVERIFIED_OFFICIAL_SOURCE');
  const chunks=regulatoryChunks(source.pages),client=this.db.getClient();
  const existing=await client.from('bot_energy_knowledge_versions').select('id,status').eq('document_key',source.documentKey).eq('version',source.version).eq('document_hash',source.documentHash).maybeSingle();
  if(existing.error)throw new ServiceUnavailableException('Não foi possível consultar o índice de normas.');
  if(existing.data?.status==='QUARANTINED')throw new Error('QUARANTINED_SOURCE');
  let versionId=existing.data?.id;
  if(!versionId){
   const inserted=await client.from('bot_energy_knowledge_versions').insert({document_key:source.documentKey,family:source.family,authority:source.authority,title:source.title,version:source.version,official_url:source.officialUrl,document_hash:source.documentHash,published_at:source.publishedAt,valid_from:source.validFrom,valid_to:source.validTo,markets:source.markets,status:'DRAFT',created_by:t.userId,fetched_at:new Date().toISOString()}).select('id').single();
   if(inserted.error||!inserted.data)throw new ServiceUnavailableException('Fonte oficial não registrada.');
   versionId=inserted.data.id;
  }
  const saved=await client.from('bot_energy_knowledge_chunks').select('ordinal,content_hash').eq('version_id',versionId).eq('embedding_model',KNOWLEDGE_EMBEDDING_MODEL).eq('embedding_version',KNOWLEDGE_EMBEDDING_VERSION);
  if(saved.error||!Array.isArray(saved.data))throw new ServiceUnavailableException('Não foi possível conferir a indexação anterior.');
  const done=new Map(saved.data.map((c:{ordinal:number;content_hash:string})=>[c.ordinal,c.content_hash]));
  if(chunks.some(c=>done.has(c.ordinal)&&done.get(c.ordinal)!==c.content_hash))throw new Error('SOURCE_PARSE_CHANGED');
  const pending=chunks.filter(c=>!done.has(c.ordinal));
  for(let offset=0;offset<pending.length;offset+=8){
   const batch=pending.slice(offset,offset+8),input=batch.map(c=>c.content);
   const reservation=await this.budget.reserve(t.organizationId,t.userId,randomUUID(),'embeddings',{inputTokens:Buffer.byteLength(JSON.stringify(input)),outputTokens:0});
   const vectors=await this.embeddings.embed(t.organizationId,input);
   await this.budget.settle(reservation,{inputTokens:vectors.inputTokens,outputTokens:0});
   const written=await client.from('bot_energy_knowledge_chunks').insert(batch.map((c,i)=>({...c,version_id:versionId,embedding_model:vectors.model,embedding_version:vectors.version,embedding:JSON.stringify(vectors.vectors[i])})));
   if(written.error)throw new ServiceUnavailableException('Indexação interrompida. Trechos já registrados serão reutilizados na retomada.');
  }
  return {versionId,state:existing.data?.status??'DRAFT',chunks:chunks.length,newChunks:pending.length,message:'Trechos indexados; liberação regulatória exige proveniência e vigência verificadas. Portais não substituem os módulos oficiais.'};
 }
}
