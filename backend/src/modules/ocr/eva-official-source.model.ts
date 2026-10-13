import {createHash} from 'node:crypto';
import {isIP} from 'node:net';
import {knownOfficialDiscoveryUrl} from '../eva-knowledge-foundation/source-catalog';

export const OFFICIAL_SOURCE_FAMILIES={
 ANEEL:['ANEEL_RULES','PRORET','PRODIST'], PLANALTO:['LEGISLATION'],
 CCEE:['CCEE_RULES','CCEE_PROCEDURES'], ONS:['ONS_PROCEDURES'],
 DISTRIBUTOR:['DISTRIBUTOR_DOCUMENTS'],
} as const;
export const OFFICIAL_SOURCE_STATES=['DRAFT','REGISTERED','SUSPENDED'] as const;
export const SOURCE_UUID=/^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
export type OfficialSourceMetadata={title:string;authority:keyof typeof OFFICIAL_SOURCE_FAMILIES;
 family:string;url:string;markets:string[];scopeNote:string;cadenceDays:number};
const fields=['title','authority','family','url','markets','scopeNote','cadenceDays'];
export function officialSourceMetadata(value:unknown):OfficialSourceMetadata|null {
 if(!value||typeof value!=='object'||Array.isArray(value))return null;
 const v=value as Record<string,unknown>;
 if(Object.keys(v).length!==fields.length||Object.keys(v).some(k=>!fields.includes(k)))return null;
 if(['title','authority','family','url','scopeNote'].some(k=>typeof v[k]!=='string'||/[\x00-\x1f\x7f]/.test(v[k] as string)))return null;
 const authority=v.authority as OfficialSourceMetadata['authority'];
 if(!Object.prototype.hasOwnProperty.call(OFFICIAL_SOURCE_FAMILIES,authority)||!(OFFICIAL_SOURCE_FAMILIES[authority] as readonly string[]).includes(v.family as string))return null;
 if((v.title as string).trim().length<2||(v.title as string).length>160||(v.scopeNote as string).length>1000||(v.url as string).length>1024)return null;
 if(!Number.isInteger(v.cadenceDays)||(v.cadenceDays as number)<1||(v.cadenceDays as number)>366)return null;
 if(!Array.isArray(v.markets)||!v.markets.length||v.markets.length>4||new Set(v.markets).size!==v.markets.length||v.markets.some(m=>!['COMMON','ACL','ACR','GD'].includes(m)))return null;
 let url:URL;try{url=new URL(v.url as string)}catch{return null}
 if(url.protocol!=='https:'||url.username||url.password||url.port||url.search||url.hash||url.hostname==='localhost'||isIP(url.hostname.replace(/^\[|\]$/g,''))||!url.hostname.includes('.')||url.hostname.endsWith('.local')||url.hostname.endsWith('.internal'))return null;
 if(authority!=='DISTRIBUTOR'&&!knownOfficialDiscoveryUrl(authority,v.url as string))return null;
 // Distributor URLs remain declarations in drafts, never an ingestion allowlist.
 return {title:(v.title as string).trim(),authority,family:v.family as string,url:url.href,
  markets:[...v.markets].sort(),scopeNote:(v.scopeNote as string).trim(),cadenceDays:v.cadenceDays as number};
}
export function officialSourceHash(metadata:OfficialSourceMetadata){
 return createHash('sha256').update(JSON.stringify(metadata)).digest('hex');
}
