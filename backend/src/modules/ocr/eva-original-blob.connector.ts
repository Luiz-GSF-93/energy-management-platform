import {Injectable,ServiceUnavailableException} from '@nestjs/common';
import {ConfigService} from '@nestjs/config';
import {BlobServiceClient} from '@azure/storage-blob';
import {ClientSecretCredential} from '@azure/identity';
import {validHash,ORIGINAL_LIMIT,sha256} from './eva-official-document.model';
export type BlobReference={objectKey:string;fileHash:string;size:number};
export type BlobEvidence={outcome:'PRESERVED'|'FAILED'|'BLOCKED'|'UNKNOWN';diagnostic:'VERIFIED'|'NOT_FOUND'|'HASH_MISMATCH'|'NETWORK_OR_HTTP'|'STORAGE_POLICY_INVALID'};
@Injectable()
export class EvaOriginalBlobConnector {
 constructor(private config:ConfigService){}
 assertEnabled(){if(this.config.get('EVA_OFFICIAL_BLOB_CALLS_ENABLED')!=='true')throw new ServiceUnavailableException('Chamadas Blob desligadas; aguardando homologação.');}
 private client(){
  this.assertEnabled();const endpoint=this.config.get<string>('EVA_OFFICIAL_BLOB_ENDPOINT')??'',container=this.config.get<string>('EVA_OFFICIAL_BLOB_CONTAINER')??'',tenant=this.config.get<string>('EVA_OFFICIAL_BLOB_TENANT_ID')??'',client=this.config.get<string>('EVA_OFFICIAL_BLOB_CLIENT_ID')??'',secret=this.config.get<string>('EVA_OFFICIAL_BLOB_CLIENT_SECRET')??'';
  if(!/^https:\/\/[a-z0-9]{3,24}\.blob\.core\.windows\.net$/.test(endpoint)||! /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(container)||container.length<3||container.length>63||! /^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(tenant)||! /^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(client)||!secret||secret.length>4096)throw new ServiceUnavailableException('Configuração privada de Blob incompleta.');
  return new BlobServiceClient(endpoint,new ClientSecretCredential(tenant,client,secret),{retryOptions:{maxTries:1,tryTimeoutInMs:10000}}).getContainerClient(container);
 }
 private reference(r:BlobReference){if(!/^official\/[a-f0-9-]{36}\/[a-f0-9-]{36}\/[a-f0-9-]{36}\.pdf$/.test(r.objectKey)||!validHash(r.fileHash)||!Number.isSafeInteger(r.size)||r.size<20||r.size>ORIGINAL_LIMIT)throw new ServiceUnavailableException('Referência de armazenamento inválida.');}
 async put(r:BlobReference,bytes:Buffer):Promise<BlobEvidence>{
  this.reference(r);if(bytes.length!==r.size||sha256(bytes)!==r.fileHash)throw new ServiceUnavailableException('Integridade local divergente.');const container=this.client(),blob=container.getBlockBlobClient(r.objectKey),signal=AbortSignal.timeout(20000);
  try{const properties=await container.getProperties({abortSignal:signal});if(properties.blobPublicAccess)return {outcome:'BLOCKED',diagnostic:'STORAGE_POLICY_INVALID'};await blob.uploadData(bytes,{abortSignal:signal,conditions:{ifNoneMatch:'*'},blobHTTPHeaders:{blobContentType:'application/pdf'},blockSize:4*1024*1024,concurrency:1});const evidence=await this.verifyBlob(blob,r,signal);return evidence.outcome==='FAILED'?{outcome:'UNKNOWN',diagnostic:'NETWORK_OR_HTTP'}:evidence}catch{return {outcome:'UNKNOWN',diagnostic:'NETWORK_OR_HTTP'}}
 }
 private async verifyBlob(blob:ReturnType<ReturnType<BlobServiceClient['getContainerClient']>['getBlockBlobClient']>,r:BlobReference,signal:AbortSignal):Promise<BlobEvidence>{
  try{const properties=await blob.getProperties({abortSignal:signal});if(properties.contentLength!==r.size)return {outcome:'BLOCKED',diagnostic:'HASH_MISMATCH'};
   const bytes=await blob.downloadToBuffer(0,r.size,{abortSignal:signal,conditions:{ifMatch:properties.etag},concurrency:1});return sha256(bytes)===r.fileHash?{outcome:'PRESERVED',diagnostic:'VERIFIED'}:{outcome:'BLOCKED',diagnostic:'HASH_MISMATCH'};
  }catch(e){return (e as {statusCode?:number})?.statusCode===404?{outcome:'FAILED',diagnostic:'NOT_FOUND'}:{outcome:'UNKNOWN',diagnostic:'NETWORK_OR_HTTP'}}
 }
 async reconcile(r:BlobReference):Promise<BlobEvidence>{this.reference(r);const container=this.client(),signal=AbortSignal.timeout(20000);try{const properties=await container.getProperties({abortSignal:signal});if(properties.blobPublicAccess)return {outcome:'BLOCKED',diagnostic:'STORAGE_POLICY_INVALID'};return this.verifyBlob(container.getBlockBlobClient(r.objectKey),r,signal)}catch{return {outcome:'UNKNOWN',diagnostic:'NETWORK_OR_HTTP'}}}
}
