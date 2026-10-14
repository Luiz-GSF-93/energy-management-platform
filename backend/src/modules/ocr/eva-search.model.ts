import {digest,exact,hash,uuid} from './eva-extraction.model';
export const SEARCH_PARSER='eva-semantic-v1';
export const SEARCH_DIMENSIONS=1536;
export type SearchSection={id:string;page:number;position:number;heading:string;content:string;content_hash:string;issues:string[]};
export type SearchSource={jobId:string;versionId:string;reviewEventId:string;contentHash:string;fileHash:string;pageCount:number;metadata:{topic:string;publishedOn:string;validFrom:string;validTo:string|null;references:string[]};sections:SearchSection[]};
export type SearchChunk={id:string;sectionId:string;ordinal:number;page:number;start:number;end:number;heading:string;text:string;textHash:string;context:string;kind:'TEXT'|'FLOW'|'TABLE';parentHash:string};
/** Boundaries are offsets of the curated text, never original PDF extraction offsets. */
export function fragmentSource(source:SearchSource):SearchChunk[]{
 if(!uuid(source.jobId)||!uuid(source.versionId)||!uuid(source.reviewEventId)||!hash(source.contentHash)||!hash(source.fileHash)||!Number.isInteger(source.pageCount)||source.pageCount<1||source.pageCount>100||!Array.isArray(source.sections)||source.sections.length<1||source.sections.length>2000)throw Error('INVALID_SOURCE');
 const result:SearchChunk[]=[];
 for(const s of source.sections){
  if(!uuid(s.id)||!Number.isInteger(s.page)||s.page<1||s.page>source.pageCount||typeof s.content!=='string'||!s.content.trim()||Buffer.byteLength(s.content)>16000||digest(s.content)!==s.content_hash||!Array.isArray(s.issues)||s.issues.length)throw Error('INVALID_SECTION');
  const kind=/Representação textual conferida das raias/.test(s.content)?'FLOW':/Atividade:|Documento:|Descrição:|Responsável pela guarda|célula vazia/.test(s.content)?'TABLE':'TEXT';
  // Preserve complete decisions/rows and cross references. A bounded whole section is safer
  // than splitting exceptions and repeating a clipped legend as if it were a new rule.
  const parts: {start:number;end:number}[]=[];
  if(kind!=='TEXT'||s.content.length<=4000)parts.push({start:0,end:s.content.length});
  else {
   const matches=[...s.content.matchAll(/\n(?=\d+\.\d+\s)/g)];let start=0;
   for(const m of matches){const at=m.index!+1;if(at-start>=1800){parts.push({start,end:at});start=at;}}
   parts.push({start,end:s.content.length});
  }
  const context=s.heading;
  for(const [ordinal,p] of parts.entries()){
   const text=s.content.slice(p.start,p.end),textHash=digest(text);
   const id=digest([SEARCH_PARSER,source.versionId,s.id,ordinal,textHash].join('|'));
   result.push({id,sectionId:s.id,ordinal,page:s.page,start:Array.from(s.content.slice(0,p.start)).length,end:Array.from(s.content.slice(0,p.end)).length,heading:s.heading,text,textHash,context,kind,parentHash:s.content_hash});
  }
 }
 if(result.length>2000||Buffer.byteLength(JSON.stringify(result))>4*1024*1024)throw Error('FRAGMENT_LIMIT');
 return result;
}
export function searchFilters(q:Record<string,unknown>){
 if(Object.keys(q).some(k=>!['page','search','state'].includes(k))||Object.values(q).some(v=>typeof v!=='string')||!/^\d{1,4}$/.test(String(q.page??0))||Number(q.page??0)>1000||String(q.search??'').length>100||q.state&&!['DRAFT','APPROVED_PRIVATE','WITHDRAWN'].includes(String(q.state)))throw Error('INVALID_FILTER');
 return {page:Number(q.page??0),search:q.search??'',state:q.state??''};
}
export function searchPrepare(b:unknown){
 if(!exact(b,['requestId','jobId','expectedVersionId','expectedReviewEventId','expectedContentHash','justification'])||!uuid(b.requestId)||!uuid(b.jobId)||!uuid(b.expectedVersionId)||!uuid(b.expectedReviewEventId)||!hash(b.expectedContentHash)||typeof b.justification!=='string'||b.justification.trim().length<20||b.justification.length>1000||/[\x00-\x1f\x7f]/.test(b.justification))throw Error('INVALID_PREPARE');
 return b;
}
