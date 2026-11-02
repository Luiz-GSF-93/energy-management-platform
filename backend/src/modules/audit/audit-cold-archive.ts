import {createHash} from 'crypto';
import {gzipSync,gunzipSync} from 'zlib';

export type ArchiveRecord={source:string;id:string;canonicalText:string;checksum:string};
export type ArchiveManifest={schema:1;organization:string;policy:string;cycle:string;records:number;uncompressedBytes:number;compressedBytes:number;checksum:string};
const hash=(v:string|Buffer)=>createHash('sha256').update(v).digest('hex');
/** Local preparation only. No storage credentials, signed URLs, or network requests. */
export function prepareColdBundle(organization:string,policy:string,cycle:string,records:ArchiveRecord[]){
 if(!organization||organization.length>100||!/^V[1-9]\d*$/.test(policy)||!/^\d{4}-\d{2}$/.test(cycle)||records.length<1||records.length>100)throw Error('INVALID_ARCHIVE_SCOPE');
 const seen=new Set<string>();let bytes=0;
 for(const r of records){bytes+=Buffer.byteLength(r.canonicalText);if(bytes>5*1024*1024||seen.has(r.source+':'+r.id)||r.source!=='energy_audit_events')throw Error('INVALID_ARCHIVE_RECORD');seen.add(r.source+':'+r.id);
  const v=JSON.parse(r.canonicalText);if(v.organization_id!==organization||v.id!==r.id||hash(r.canonicalText)!==r.checksum)throw Error('ARCHIVE_INTEGRITY_MISMATCH');
 }
 const plain=Buffer.from(JSON.stringify({schema:1,organization,policy,cycle,records}),'utf8'),body=gzipSync(plain);
 const manifest:ArchiveManifest={schema:1,organization,policy,cycle,records:records.length,uncompressedBytes:plain.length,compressedBytes:body.length,checksum:hash(body)};
 return {body,manifest};
}
export function verifyColdBundle(body:Buffer,manifest:ArchiveManifest,authorizedOrganization:string){
 if(manifest.organization!==authorizedOrganization||body.length!==manifest.compressedBytes||hash(body)!==manifest.checksum)throw Error('ARCHIVE_SCOPE_OR_CHECKSUM_MISMATCH');
 const plain=gunzipSync(body,{maxOutputLength:6*1024*1024});if(plain.length!==manifest.uncompressedBytes)throw Error('ARCHIVE_LENGTH_MISMATCH');
 const data=JSON.parse(plain.toString('utf8'));if(data.organization!==authorizedOrganization||data.policy!==manifest.policy||data.cycle!==manifest.cycle||data.schema!==1||data.records?.length!==manifest.records)throw Error('ARCHIVE_MANIFEST_MISMATCH');
 prepareColdBundle(data.organization,data.policy,data.cycle,data.records);return data.records as ArchiveRecord[];
}
export interface ColdArchiveDestination {
 readonly state:'HOMOLOGATED';
 putPrivate(bundle:ReturnType<typeof prepareColdBundle>):Promise<{objectId:string;checksum:string}>;
 restorePrivate(objectId:string,organization:string):Promise<Buffer>;
}
export function requireColdDestination(destination?:ColdArchiveDestination){if(!destination||destination.state!=='HOMOLOGATED')throw Error('WAITING_STORAGE');return destination;}
