import {digest,exact,hash,justification,uuid} from './eva-extraction.model';
import {fragmentSource,SearchSource} from './eva-search.model';
import {knowledgeCatalogue,officialKnowledgeUrl} from './bot-energy-knowledge';

export const COMPOSITE_VERSION='eva-composite-v1';
export const COMPOSITE_LIMITS={pages:500,parts:25,chunks:2000,batch:100,text:6000,bytes:4*1024*1024} as const;
export type CompositeCoverage={page:number;state:'INCLUDED'|'MIXED'|'EXCLUDED';hash:string};
export type CompositePart=SearchSource&{ordinal:number;startPage:number;endPage:number;coverage?:CompositeCoverage[]};
export type CompositeCandidate={setId:string;chainId:string;manifestHash:string;originalHash:string;pages:number;documentId:string;title:string;edition:string;url:string;authority:string;family:string;markets:string[];parts:CompositePart[]};
export type CompositeChunk={id:string;partOrdinal:number;jobId:string;versionId:string;sectionId:string;ordinal:number;page:number;partPage:number;start:number;end:number;heading:string;context:string;text:string;textHash:string;parentHash:string};
const day=(x:unknown):x is string=>typeof x==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(x)&&Number.isFinite(Date.parse(x))&&new Date(x).toISOString().slice(0,10)===x;

/** Input is reviewed source material, never executable instructions or permission claims. */
export function prepareComposite(c:CompositeCandidate){
 if(!c||![c.setId,c.chainId,c.documentId].every(uuid)||![c.manifestHash,c.originalHash].every(hash)||!Number.isInteger(c.pages)||c.pages<101||c.pages>COMPOSITE_LIMITS.pages||
  ![c.title,c.edition].every(x=>typeof x==='string'&&x.trim()&&x.length<=200)||!knowledgeCatalogue.some(k=>k.authority===c.authority&&k.family===c.family)||!officialKnowledgeUrl(c.authority as any,c.url)||
  !Array.isArray(c.markets)||!c.markets.length||c.markets.some(m=>!['COMMON','ACL','ACR','GD'].includes(m))||!Array.isArray(c.parts)||c.parts.length<2||c.parts.length>COMPOSITE_LIMITS.parts)throw Error('INVALID_COMPOSITE_SOURCE');
 const chunks:CompositeChunk[]=[],seenJobs=new Set<string>(),seenSections=new Set<string>(),references=new Set<string>();let next=1;
 const metadata=c.parts[0]?.metadata;
 if(!metadata||!day(metadata.publishedOn)||!day(metadata.validFrom)||(metadata.validTo!==null&&(!day(metadata.validTo)||metadata.validTo<=metadata.validFrom))||typeof metadata.topic!=='string'||!metadata.topic.trim()||metadata.topic.length>2000)throw Error('INVALID_APPLICABILITY');
 for(const [i,p] of c.parts.entries()){
  if(p.ordinal!==i+1||p.startPage!==next||p.endPage<p.startPage||p.endPage-p.startPage>=40||p.pageCount!==p.endPage-p.startPage+1||seenJobs.has(p.jobId)||
   ['publishedOn','validFrom','validTo','topic'].some(k=>(p.metadata as any)?.[k]!==(metadata as any)[k])||!Array.isArray(p.metadata.references)||!p.metadata.references.length)throw Error('INCOMPLETE_OR_MIXED_COMPOSITE');
  seenJobs.add(p.jobId);next=p.endPage+1;
  for(const ref of p.metadata.references){if(typeof ref!=='string'||ref.length>2048||!ref.startsWith('https://'))throw Error('INVALID_REFERENCE');references.add(ref);}
  const covered=new Set(p.sections.map(s=>s.page));
  if(p.coverage!==undefined){
   if(!Array.isArray(p.coverage)||p.coverage.length!==p.pageCount||p.coverage.some((x,i)=>!exact(x,['page','state','hash'])||x.page!==i+1||!['INCLUDED','MIXED','EXCLUDED'].includes(x.state)||!hash(x.hash)||(x.state==='EXCLUDED')===covered.has(x.page)))throw Error('INVALID_REVIEWED_COVERAGE');
  }else if(covered.size!==p.pageCount||Array.from({length:p.pageCount},(_,i)=>i+1).some(n=>!covered.has(n)))throw Error('MISSING_PART_PAGE');
  for(const section of p.sections){if(seenSections.has(section.id))throw Error('DUPLICATE_SECTION');seenSections.add(section.id);}
  for(const x of fragmentSource(p)){
   if(x.text.length>COMPOSITE_LIMITS.text||Buffer.byteLength(x.text)>16000)throw Error('CURATE_OVERSIZED_SECTION');
   chunks.push({id:digest([COMPOSITE_VERSION,c.setId,p.ordinal,x.id].join('|')),partOrdinal:p.ordinal,jobId:p.jobId,versionId:p.versionId,sectionId:x.sectionId,ordinal:x.ordinal,
    page:p.startPage+x.page-1,partPage:x.page,start:x.start,end:x.end,heading:x.heading,context:x.context,text:x.text,textHash:x.textHash,parentHash:x.parentHash});
  }
 }
 if(next!==c.pages+1||!chunks.length||chunks.length>COMPOSITE_LIMITS.chunks||references.size>50)throw Error('COMPOSITE_COVERAGE_OR_LIMIT');
 const manifest={version:COMPOSITE_VERSION,setId:c.setId,chainId:c.chainId,sourceManifestHash:c.manifestHash,originalFileHash:c.originalHash,originalPageCount:c.pages,documentId:c.documentId,
  title:c.title,edition:c.edition,url:c.url,authority:c.authority,family:c.family,markets:c.markets,metadata:{...metadata,references:[...references].sort()},
  parts:c.parts.map(p=>({ordinal:p.ordinal,startPage:p.startPage,endPage:p.endPage,jobId:p.jobId,versionId:p.versionId,reviewEventId:p.reviewEventId,contentHash:p.contentHash,fileHash:p.fileHash,...(p.coverage===undefined?{}:{coverage:p.coverage})})),chunkTotal:chunks.length};
 const batches=Array.from({length:Math.ceil(chunks.length/COMPOSITE_LIMITS.batch)},(_,i)=>({ordinal:i+1,chunks:chunks.slice(i*COMPOSITE_LIMITS.batch,(i+1)*COMPOSITE_LIMITS.batch)}));
 const result={manifest,batches};if(Buffer.byteLength(JSON.stringify(result))>COMPOSITE_LIMITS.bytes)throw Error('COMPOSITE_BYTES_LIMIT');return result;
}

export function compositePrepareCommand(b:unknown):b is {requestId:string;setId:string;expectedManifestHash:string;justification:string}{
 return exact(b,['requestId','setId','expectedManifestHash','justification'])&&uuid(b.requestId)&&uuid(b.setId)&&hash(b.expectedManifestHash)&&justification(b.justification);
}
export function compositeFilters(q:Record<string,unknown>){
 if(Object.keys(q).some(k=>!['page','search','state'].includes(k))||Object.values(q).some(v=>typeof v!=='string')||!/^\d{1,3}$/.test(String(q.page??'0'))||String(q.search??'').length>100||
  !['','DRAFT','APPROVED_PRIVATE','INDEXING','INDEXED_PRIVATE','PUBLISHING','ACTIVE','UNKNOWN','QUARANTINED'].includes(String(q.state??'')))throw Error('INVALID_COMPOSITE_FILTER');
 return {page:Number(q.page??0),search:q.search??'',state:q.state??''};
}
