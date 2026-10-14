import {Injectable,ServiceUnavailableException} from '@nestjs/common';
import {ConfigService} from '@nestjs/config';
import {ClientSecretCredential} from '@azure/identity';
import {uuid} from './eva-extraction.model';
/** Global official corpus only; never consumes a tenant's AI budget or credential. */
@Injectable()
export class EvaSearchEmbeddingConnector{
 constructor(private config:ConfigService){}
 async embed(text:string){
  if(this.config.get('EVA_SEARCH_EMBEDDING_CALLS_ENABLED')!=='true')throw new ServiceUnavailableException('Embeddings oficiais desligados.');
  const endpoint=this.config.get<string>('EVA_SEARCH_EMBEDDING_ENDPOINT')??'',deployment=this.config.get<string>('EVA_SEARCH_EMBEDDING_DEPLOYMENT')??'';
  const tenant=this.config.get<string>('EVA_SEARCH_TENANT_ID')??'',client=this.config.get<string>('EVA_SEARCH_EMBEDDING_CLIENT_ID')??'',secret=this.config.get<string>('EVA_SEARCH_EMBEDDING_CLIENT_SECRET')??'';
  if(!/^https:\/\/[a-z0-9][a-z0-9-]{1,62}\.openai\.azure\.com\/?$/.test(endpoint)||! /^[a-z0-9][a-z0-9-]{1,63}$/.test(deployment)||!uuid(tenant)||!uuid(client)||!secret||secret.length>4096||!text.trim()||text.length>6000||Buffer.byteLength(text)>16000)throw new ServiceUnavailableException('Configuração ou texto de embedding inválido.');
  try{
   const signal=AbortSignal.timeout(15000),token=await new ClientSecretCredential(tenant,client,secret).getToken('https://cognitiveservices.azure.com/.default',{abortSignal:signal});
   if(!token)throw Error();
   const response=await fetch(new URL('/openai/v1/embeddings',endpoint),{method:'POST',redirect:'error',signal,headers:{Authorization:`Bearer ${token.token}`,'Content-Type':'application/json'},body:JSON.stringify({model:deployment,input:[text],dimensions:1536,encoding_format:'float'})});
   if(!response.ok||!response.body)throw Error();
   const reader=response.body.getReader(),parts:Buffer[]=[];let size=0;
   try{for(;;){const item=await reader.read();if(item.done)break;size+=item.value.length;if(size>100000){await reader.cancel();throw Error();}parts.push(Buffer.from(item.value));}}finally{reader.releaseLock();}
   const data=JSON.parse(Buffer.concat(parts).toString('utf8')),vector=data.data?.[0]?.embedding,tokens=data.usage?.prompt_tokens;
   if(data.model!=='text-embedding-3-small'||data.data?.length!==1||data.data[0].index!==0||!Array.isArray(vector)||vector.length!==1536||vector.some((x:unknown)=>typeof x!=='number'||!Number.isFinite(x)||Math.abs(x)>1)||!vector.some((x:number)=>x!==0)||!Number.isSafeInteger(tokens)||tokens<1||tokens>Buffer.byteLength(text)||data.usage.total_tokens!==tokens)throw Error();
   return {vector:vector as number[],tokens:tokens as number};
  }catch{throw new ServiceUnavailableException('Embedding não confirmado; preserve a tentativa.');}
 }
}
