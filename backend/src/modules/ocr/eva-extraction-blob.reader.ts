import {Injectable,ServiceUnavailableException} from '@nestjs/common';
import {ConfigService} from '@nestjs/config';
import {ClientSecretCredential} from '@azure/identity';
import {BlobServiceClient} from '@azure/storage-blob';
import {digest,ExtractionError,hash,uuid} from './eva-extraction.model';
export type ExtractionReference={objectKey:string;fileHash:string;size:number};
@Injectable()
export class EvaExtractionBlobReader{
 constructor(private config:ConfigService){}
 enabled(){return this.config.get('EVA_OFFICIAL_EXTRACTION_BLOB_CALLS_ENABLED')==='true';}
 async read(r:ExtractionReference):Promise<Buffer>{
  if(!this.enabled())throw new ServiceUnavailableException('Leitura Blob da extração desligada.');
  if(!/^official\/[a-f0-9-]{36}\/[a-f0-9-]{36}\/[a-f0-9-]{36}\.pdf$/.test(r.objectKey)||!hash(r.fileHash)||!Number.isInteger(r.size)||r.size<20||r.size>25*1024*1024)throw new ExtractionError('INTEGRITY');
  const endpoint=this.config.get<string>('EVA_OFFICIAL_BLOB_ENDPOINT')??'',container=this.config.get<string>('EVA_OFFICIAL_BLOB_CONTAINER')??'',tenant=this.config.get<string>('EVA_OFFICIAL_BLOB_TENANT_ID'),client=this.config.get<string>('EVA_OFFICIAL_BLOB_CLIENT_ID'),secret=this.config.get<string>('EVA_OFFICIAL_BLOB_CLIENT_SECRET');
  if(!/^https:\/\/[a-z0-9]{3,24}\.blob\.core\.windows\.net$/.test(endpoint)||! /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(container)||container.length<3||container.length>63||!uuid(tenant)||!uuid(client)||!secret||secret.length>4096)throw new ExtractionError('INTEGRITY');
  try{
   const c=new BlobServiceClient(endpoint,new ClientSecretCredential(tenant,client,secret),{retryOptions:{maxTries:1,tryTimeoutInMs:10000}}).getContainerClient(container),signal=AbortSignal.timeout(20000);
   const cp=await c.getProperties({abortSignal:signal});if(cp.blobPublicAccess)throw new ExtractionError('INTEGRITY');
   const blob=c.getBlockBlobClient(r.objectKey),p=await blob.getProperties({abortSignal:signal});if(p.contentLength!==r.size)throw new ExtractionError('INTEGRITY');
   const bytes=await blob.downloadToBuffer(0,r.size,{abortSignal:signal,conditions:{ifMatch:p.etag},concurrency:1});if(bytes.length!==r.size||digest(bytes)!==r.fileHash)throw new ExtractionError('INTEGRITY');return bytes;
  }catch(e){if(e instanceof ExtractionError)throw e;throw new ExtractionError('NETWORK');}
 }
}
