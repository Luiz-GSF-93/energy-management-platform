import {BackofficeAiConfig,AzureBackofficeAiConnector,BackofficeAiError} from './azure-backoffice-ai.connector';

export const KNOWLEDGE_EMBEDDING_DIMENSIONS=1536;
export const KNOWLEDGE_EMBEDDING_MODEL='text-embedding-3-small';
export const KNOWLEDGE_EMBEDDING_VERSION='1';

export function knowledgeEmbeddingConfig(env:NodeJS.ProcessEnv):BackofficeAiConfig{
 return {licenseMode:env.BOT_ENERGY_LICENSE_MODE==='true',enabled:env.BOT_ENERGY_RAG_ENABLED==='true',organizations:(env.BOT_ENERGY_AI_ORGANIZATIONS??'').split(',').map(v=>v.trim()).filter(Boolean),endpoint:env.AZURE_OPENAI_ENDPOINT,key:env.AZURE_OPENAI_API_KEY,deployment:env.AZURE_OPENAI_EMBEDDING_DEPLOYMENT};
}

// Internal transport only. Caller must authorize the tenant and reserve its consumption
// budget before sending text. Not registered as an exposed endpoint or ingestion worker.
export class AzureKnowledgeEmbeddingsConnector{
 private readonly configurationGuard:AzureBackofficeAiConnector;
 constructor(private readonly config:BackofficeAiConfig,private readonly transport:typeof fetch=fetch){
  this.configurationGuard=new AzureBackofficeAiConnector(config,transport);
 }
 available(org:string){return this.configurationGuard.available(org);}
 async embed(org:string,input:string[]){
  if(!this.available(org))throw new BackofficeAiError('NOT_CONFIGURED');
  if(!Array.isArray(input)||input.length<1||input.length>8||input.some(v=>typeof v!=='string'||!v.trim()||v.length>6000)||Buffer.byteLength(JSON.stringify(input),'utf8')>48000)throw new BackofficeAiError('CONTEXT_LIMIT');
  const url=new URL('/openai/v1/embeddings',this.config.endpoint);
  let response:Response;
  try{
   response=await this.transport(url,{method:'POST',redirect:'error',signal:AbortSignal.timeout(12000),headers:{'Content-Type':'application/json','api-key':this.config.key!},body:JSON.stringify({model:this.config.deployment,input,dimensions:KNOWLEDGE_EMBEDDING_DIMENSIONS,encoding_format:'float'})});
  }catch{throw new BackofficeAiError('PROVIDER_UNAVAILABLE');}
  if(!response.ok||!response.body)throw new BackofficeAiError('PROVIDER_UNAVAILABLE');
  const reader=response.body.getReader(),parts:Buffer[]=[];let bytes=0;
  try{
   while(true){const p=await reader.read();if(p.done)break;bytes+=p.value.byteLength;if(bytes>512000){await reader.cancel();throw new Error();}parts.push(Buffer.from(p.value));}
  }catch{throw new BackofficeAiError('INVALID_RESPONSE');}finally{reader.releaseLock();}
  try{
   const body=JSON.parse(Buffer.concat(parts).toString('utf8'));
   if(body.model!==KNOWLEDGE_EMBEDDING_MODEL||!Array.isArray(body.data)||body.data.length!==input.length||!Number.isSafeInteger(body.usage?.prompt_tokens)||body.usage.prompt_tokens<=0||body.usage.prompt_tokens>48000||body.usage.total_tokens!==body.usage.prompt_tokens)throw new Error();
   const data=body.data.sort((a:any,b:any)=>a.index-b.index);
   if(data.some((d:any,i:number)=>d.index!==i||!Array.isArray(d.embedding)||d.embedding.length!==KNOWLEDGE_EMBEDDING_DIMENSIONS||d.embedding.some((n:unknown)=>typeof n!=='number'||!Number.isFinite(n)||Math.abs(n)>1)||!d.embedding.some((n:number)=>n!==0)))throw new Error();
   return {vectors:data.map((d:any)=>d.embedding as number[]),model:KNOWLEDGE_EMBEDDING_MODEL,version:KNOWLEDGE_EMBEDDING_VERSION,dimensions:KNOWLEDGE_EMBEDDING_DIMENSIONS,inputTokens:body.usage.prompt_tokens as number};
  }catch{throw new BackofficeAiError('INVALID_RESPONSE');}
 }
}
