import {searchDocumentId} from './eva-search.model';
import {hash,uuid} from './eva-extraction.model';
import {knowledgeCatalogue,officialKnowledgeUrl,KnowledgeAuthority,knowledgeTextHash,KnowledgeQuery} from './bot-energy-knowledge';

export type CorpusChunk={id:string;text:string;contentHash:string;vector:number[]};
export type CorpusClaim={id:string;releaseId:string;revisionId:string;leaseId:string;readOnly:boolean;chunks:CorpusChunk[]};
export type CorpusProof={publicationId:string;eventId:string};
export function corpusCceeQuestion(question:string){return /\bccee\b|\bpdc\b|varejista|modelo simplificado|procedimentos? de comercializa/.test(question.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,''));}
export type CorpusSource={publicationId:string;publicationEventId:string;releaseId:string;revisionId:string;documentId:string;title:string;version:string;url:string;family:string;authority:KnowledgeAuthority;markets:string[];validFrom:string;validTo:string|null;topic:string;fileHash:string;reviewedAt:string;reviewedBy:string;chunkTotal:number};
export const corpusDay=(s:string)=>typeof s==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(s)&&!Number.isNaN(Date.parse(s))&&new Date(s).toISOString().slice(0,10)===s;
export function corpusRemoteMatches(c:CorpusClaim,x:CorpusChunk,r:any,published:boolean){
 return !!r&&hash(x.id)&&hash(x.contentHash)&&knowledgeTextHash(x.text)===x.contentHash&&
  r.id===searchDocumentId(c.releaseId,x.id)&&r.chunkId===x.id&&r.releaseId===c.releaseId&&r.revisionId===c.revisionId&&r.contentHash===x.contentHash&&
  r.scope==='OFFICIAL_PUBLIC'&&r.audience==='PLATFORM'&&r.published===published&&r.text===x.text&&Array.isArray(x.vector)&&x.vector.length===1536&&Array.isArray(r.vector)&&r.vector.length===1536&&
  x.vector.every((v,i)=>Number.isFinite(v)&&Number.isFinite(r.vector[i])&&Math.abs(r.vector[i]-v)<=0.000001);
}
export function validateCorpusSources(value:unknown,q:Pick<KnowledgeQuery,'periodStart'|'periodEnd'|'market'>):CorpusSource[]{
 if(!corpusDay(q.periodStart)||!corpusDay(q.periodEnd)||q.periodStart>q.periodEnd||!['COMMON','ACL','ACR','GD'].includes(q.market))throw Error('Invalid period');
 if(!Array.isArray(value)||value.length>8)throw Error('Invalid corpus');
 const seen=new Set<string>();
 for(const s of value){
  if(!s||!['publicationId','publicationEventId','releaseId','revisionId','documentId','reviewedBy'].every(k=>uuid(s[k]))||seen.has(s.releaseId)||!knowledgeCatalogue.some(k=>k.family===s.family&&k.authority===s.authority)||!officialKnowledgeUrl(s.authority,s.url)||!hash(s.fileHash)||
   !corpusDay(s.validFrom)||(s.validTo!==null&&(!corpusDay(s.validTo)||s.validTo<=s.validFrom))||!Array.isArray(s.markets)||!s.markets.length||s.markets.some((m:string)=>!['COMMON','ACL','ACR','GD'].includes(m))||(!s.markets.includes('COMMON')&&!s.markets.includes(q.market))||s.validFrom>q.periodEnd||(s.validTo!==null&&s.validTo<=q.periodStart)||
   !['title','version','topic'].every(k=>typeof s[k]==='string'&&s[k].trim()&&s[k].length<=2000)||!Number.isFinite(Date.parse(s.reviewedAt))||!Number.isInteger(s.chunkTotal)||s.chunkTotal<1||s.chunkTotal>100)throw Error('Invalid corpus source');
  seen.add(s.releaseId);
 }
 return value;
}
export function corpusVersionConflict(sources:CorpusSource[],q:Pick<KnowledgeQuery,'periodStart'|'periodEnd'>){
 const docs=new Map<string,Set<string>>();
 for(const s of sources){if(s.validFrom>q.periodStart||s.validTo!==null&&s.validTo<=q.periodEnd)return true;const v=docs.get(s.documentId)??new Set<string>();v.add(s.version+'|'+s.fileHash);docs.set(s.documentId,v);}
 return [...docs.values()].some(v=>v.size>1);
}
