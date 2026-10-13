import {createHash} from 'node:crypto';
import {SOURCE_UUID} from './eva-official-source.model';
export const ORIGINAL_LIMIT=25*1024*1024;
export const STORAGE_STATES=['PREPARED','RESERVED','RECONCILING','PRESERVED','UNKNOWN','FAILED','BLOCKED'] as const;
export type OriginalFile={buffer:Buffer;size:number;originalname:string;mimetype:string};
export const sha256=(b:Buffer|string)=>createHash('sha256').update(b).digest('hex');
export function exact(value:unknown,keys:string[]):value is Record<string,any>{return !!value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).length===keys.length&&keys.every(k=>Object.prototype.hasOwnProperty.call(value,k));}
export const validHash=(v:unknown)=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
const text=(v:unknown,min:number,max:number)=>typeof v==='string'&&v.trim().length>=min&&v.length<=max&&!/[\x00-\x1f\x7f]/.test(v);
export function documentDay(v:unknown){return typeof v==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(v)&&Number.isFinite(Date.parse(v))&&new Date(v).toISOString().slice(0,10)===v;}
export function documentMetadata(v:unknown){
 if(!exact(v,['title','edition','url','publishedOn','validFrom','validTo','provenance'])||!text(v.title,2,160)||!text(v.edition,1,100)||!text(v.provenance,20,1000)||!text(v.url,10,1024))return null;
 try{const u=new URL(v.url);if(u.protocol!=='https:'||u.username||u.password||u.port||u.search||u.hash||!/^https:\/\/[a-z0-9.-]+\.[a-z]{2,}(\/[^?#\s]*)?$/.test(v.url))return null}catch{return null}
 for(const k of ['publishedOn','validFrom','validTo'])if(v[k]!==null&&!documentDay(v[k]))return null;
 if(v.validTo!==null&&(v.validFrom===null||v.validTo<=v.validFrom))return null;
 return {title:v.title.trim(),edition:v.edition.trim(),url:v.url,publishedOn:v.publishedOn,validFrom:v.validFrom,validTo:v.validTo,provenance:v.provenance.trim()};
}
export const metadataHash=(v:object)=>sha256(JSON.stringify(v,Object.keys(v).sort()));
export function documentCommand(v:unknown,extra:string[]=[]){
 if(!exact(v,['requestId','expectedEventId','expectedRevisionHash','justification',...extra])||typeof v.requestId!=='string'||!SOURCE_UUID.test(v.requestId)||!text(v.justification,20,1000))return false;
 return (v.expectedEventId===null&&v.expectedRevisionHash===null)||(typeof v.expectedEventId==='string'&&SOURCE_UUID.test(v.expectedEventId)&&validHash(v.expectedRevisionHash));
}
