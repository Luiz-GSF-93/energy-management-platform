import {exact,hash,justification,uuid} from './eva-extraction.model';
export type PageDisposition={page:number;state:'INCLUDED'|'MIXED'|'EXCLUDED';segments:{heading:string;text:string}[];exclusion:null|{reason:string;reference:string;anchor:string}};
export function pageCurationCommand(x:unknown):x is {requestId:string;justification:string;expectedVersionId:string;expectedCurationEventId:string;expectedContentHash:string}{return exact(x,['requestId','justification','expectedVersionId','expectedCurationEventId','expectedContentHash'])&&uuid(x.requestId)&&uuid(x.expectedVersionId)&&uuid(x.expectedCurationEventId)&&hash(x.expectedContentHash)&&justification(x.justification);}
const date=(s:unknown)=>s===null||typeof s==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(s)&&Number.isFinite(Date.parse(s))&&new Date(s).toISOString().slice(0,10)===s;
export function pageCurationFile(x:unknown):x is {metadata:Record<string,unknown>;pages:PageDisposition[]}{
 if(!exact(x,['metadata','pages'])||!exact(x.metadata,['publishedOn','validFrom','validTo','topic','references'])||!['publishedOn','validFrom','validTo'].every(k=>date(x.metadata[k]))||x.metadata.validTo!==null&&(x.metadata.validFrom===null||x.metadata.validTo<=x.metadata.validFrom)||typeof x.metadata.topic!=='string'||x.metadata.topic.length<2||x.metadata.topic.length>200||!Array.isArray(x.metadata.references)||x.metadata.references.length>10||x.metadata.references.some((s:unknown)=>typeof s!=='string'||s.length>1024)||!Array.isArray(x.pages)||!x.pages.length||x.pages.length>40)return false;
 let count=0;
 for(const [i,p] of x.pages.entries()){
  if(!exact(p,['page','state','segments','exclusion'])||p.page!==i+1||!['INCLUDED','MIXED','EXCLUDED'].includes(p.state)||!Array.isArray(p.segments)||p.segments.length>200||p.state==='EXCLUDED'&&p.segments.length!==0||p.state!=='EXCLUDED'&&!p.segments.length)return false;
  if(p.state==='INCLUDED'){if(p.exclusion!==null)return false;}
  else if(!exact(p.exclusion,['reason','reference','anchor'])||!justification(p.exclusion.reason)||typeof p.exclusion.reference!=='string'||!p.exclusion.reference.trim()||p.exclusion.reference.length>2048||typeof p.exclusion.anchor!=='string'||!p.exclusion.anchor.trim()||p.exclusion.anchor.length>1000)return false;
  for(const s of p.segments)if(!exact(s,['heading','text'])||typeof s.heading!=='string'||s.heading.length>200||typeof s.text!=='string'||!s.text.trim()||s.text.length>6000||Buffer.byteLength(s.text)>16000||/\u0000/.test(s.text))return false;
  count+=p.segments.length;
 }
 return count>0&&count<=2000&&Buffer.byteLength(JSON.stringify(x))<=2*1024*1024;
}
