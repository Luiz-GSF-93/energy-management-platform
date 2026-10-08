import {createHash} from 'node:crypto';
// The review digest covers normalized values, not per-request SOAP metadata.
export function pldReviewDigest(preview:{organizationId:string;months:unknown;source:string;method:string}){
 return createHash('sha256').update(JSON.stringify({organizationId:preview.organizationId,months:preview.months,source:preview.source,method:preview.method})).digest('hex');
}
