import {createHash} from 'node:crypto';
export const EXTRACTION_VERSION='pdfjs-6.4.299-text-v1';
export const EXTRACTION_LIMITS={bytes:25*1024*1024,pages:100,textBytes:2*1024*1024,sections:2000,sectionChars:2800,timeoutMs:60000};
export const EXTRACTION_STATES=['QUEUED','RUNNING','SUCCEEDED','OCR_REQUIRED','BLOCKED','FAILED','WITHDRAWN','DRAFT','REVIEWED','QUARANTINED'];
export const uuid=(v:unknown):v is string=>typeof v==='string'&&/^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(v);
export const hash=(v:unknown):v is string=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
export const digest=(v:string|Buffer)=>createHash('sha256').update(v).digest('hex');
export const object=(v:unknown):v is Record<string,any>=>!!v&&typeof v==='object'&&!Array.isArray(v);
export const exact=(v:unknown,keys:string[]):v is Record<string,any>=>object(v)&&Object.keys(v).length===keys.length&&keys.every(k=>Object.prototype.hasOwnProperty.call(v,k));
export const justification=(v:unknown):v is string=>typeof v==='string'&&v.trim().length>=20&&v.trim().length<=1000&&!/[\u0000-\u001f\u007f]/.test(v);
export type ExtractionSection={page:number;start:number;end:number;heading:string;text:string;hash:string;issues:string[]};
export type ExtractionResult={pageCount:number;sections:ExtractionSection[];contentHash:string;ocrRequired:boolean};
export class ExtractionError extends Error{constructor(readonly code:'INTEGRITY'|'LIMIT'|'PDF_INVALID'|'NETWORK'|'EXTRACTION_FAILED'){super(code)}}
export function validateExtractionResult(v:unknown):v is ExtractionResult{
 if(!exact(v,['pageCount','sections','contentHash','ocrRequired'])||!Number.isInteger(v.pageCount)||v.pageCount<1||v.pageCount>100||!hash(v.contentHash)||typeof v.ocrRequired!=='boolean'||!Array.isArray(v.sections)||v.sections.length<1||v.sections.length>2000)return false;
 let bytes=0;const pages=new Set<number>();
 for(const s of v.sections){if(!exact(s,['page','start','end','heading','text','hash','issues'])||!Number.isInteger(s.page)||s.page<1||s.page>v.pageCount||!Number.isInteger(s.start)||s.start<0||!Number.isInteger(s.end)||s.end<s.start||typeof s.text!=='string'||s.end-s.start!==s.text.length||Buffer.byteLength(s.text)>16000||typeof s.heading!=='string'||s.heading.length>200||!hash(s.hash)||digest(s.text)!==s.hash||!Array.isArray(s.issues)||s.issues.some((i:unknown)=>!['EMPTY_PAGE','LAYOUT_REVIEW','IMAGE_PRESENT'].includes(String(i)))||!v.ocrRequired&&s.issues.includes('EMPTY_PAGE'))return false;bytes+=Buffer.byteLength(s.text);pages.add(s.page);}
 return bytes<=EXTRACTION_LIMITS.textBytes&&pages.size===v.pageCount&&digest(JSON.stringify({pageCount:v.pageCount,sections:v.sections,ocrRequired:v.ocrRequired}))===v.contentHash;
}
