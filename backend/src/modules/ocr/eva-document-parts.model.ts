import {digest,exact,hash,uuid,justification} from './eva-extraction.model';
export const PARTS_VERSION='pdf-lib-1.17.1-parts-v1';
export const PARTS_LIMITS={bytes:25*1024*1024,pages:500,parts:25,partPages:40,timeoutMs:90000};
export type Part={ordinal:number;startPage:number;endPage:number;pageCount:number;fileHash:string;size:number;pageTextHashes:string[]};
export type PartManifest={version:typeof PARTS_VERSION;originalFileHash:string;originalPageCount:number;parts:Part[]};
export type PartOutput={manifest:PartManifest;files:Buffer[]};
export function validManifest(v:unknown):v is PartManifest{
 if(!exact(v,['version','originalFileHash','originalPageCount','parts'])||v.version!==PARTS_VERSION||!hash(v.originalFileHash)||!Number.isInteger(v.originalPageCount)||v.originalPageCount<101||v.originalPageCount>PARTS_LIMITS.pages||!Array.isArray(v.parts)||v.parts.length<2||v.parts.length>PARTS_LIMITS.parts)return false;
 let next=1;const hashes=new Set<string>();
 for(const [index,p] of v.parts.entries()){
  if(!exact(p,['ordinal','startPage','endPage','pageCount','fileHash','size','pageTextHashes'])||p.ordinal!==index+1||p.startPage!==next||!Number.isInteger(p.endPage)||p.endPage<p.startPage||p.pageCount!==p.endPage-p.startPage+1||p.pageCount>PARTS_LIMITS.partPages||!hash(p.fileHash)||p.fileHash===v.originalFileHash||hashes.has(p.fileHash)||!Number.isInteger(p.size)||p.size<20||p.size>PARTS_LIMITS.bytes||!Array.isArray(p.pageTextHashes)||p.pageTextHashes.length!==p.pageCount||!p.pageTextHashes.every(hash))return false;
  next=p.endPage+1;hashes.add(p.fileHash);
 }
 return next===v.originalPageCount+1;
}
export function validPrepare(v:unknown):v is {requestId:string;documentId:string;expectedEventId:string;expectedRevisionHash:string;operationId:string;justification:string}{return exact(v,['requestId','documentId','expectedEventId','expectedRevisionHash','operationId','justification'])&&uuid(v.requestId)&&uuid(v.documentId)&&uuid(v.expectedEventId)&&hash(v.expectedRevisionHash)&&uuid(v.operationId)&&justification(v.justification);}
export function validOutput(v:PartOutput){return !!v&&validManifest(v.manifest)&&Array.isArray(v.files)&&v.files.length===v.manifest.parts.length&&v.files.every((b,i)=>Buffer.isBuffer(b)&&b.length===v.manifest.parts[i].size&&digest(b)===v.manifest.parts[i].fileHash);}
