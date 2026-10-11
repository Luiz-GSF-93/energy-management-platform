import {createHash,createHmac,timingSafeEqual} from 'node:crypto';

// Protocol helpers only: no transport, credentials, notification or signature action.
export const CLICKSIGN_SANDBOX_API='https://sandbox.clicksign.com/api/v3';
export function signatureEnvelope(requestId:string){
 if(!/^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(requestId))throw new Error('Invalid request ID');
 return {data:{type:'envelopes',attributes:{name:`EnergyOS HOMOLOGAÇÃO ${requestId}`,locale:'pt-BR',auto_close:false}}};
}
export function signatureEnvelopeStatus(value:unknown,expectedId:string){
 const v=value as any;
 if(!v||v.data?.type!=='envelopes'||v.data?.id!==expectedId||!['draft','running','closed','canceled'].includes(v.data?.attributes?.status))throw new Error('Invalid envelope response');
 // closed alone never establishes signatures, legal powers or production eligibility.
 return {externalId:expectedId,status:v.data.attributes.status,environment:'SANDBOX' as const,realActivationEligible:false as const};
}
export function signatureWebhookHash(raw:Buffer,secret:string){return createHmac('sha256',secret).update(raw).digest('hex');}
export function verifySignatureWebhook(raw:Buffer,header:unknown,secret:unknown){
 if(!Buffer.isBuffer(raw)||raw.length===0||raw.length>262144||typeof secret!=='string'||secret.length<16||typeof header!=='string'||!/^sha256=[a-f0-9]{64}$/.test(header))return false;
 return timingSafeEqual(Buffer.from(header.slice(7),'hex'),Buffer.from(signatureWebhookHash(raw,secret),'hex'));
}
export function signaturePdfHash(pdf:Buffer){
 if(!Buffer.isBuffer(pdf)||pdf.length<100||pdf.length>3145728||pdf.subarray(0,5).toString()!=='%PDF-'||!pdf.subarray(-1024).includes(Buffer.from('%%EOF')))throw new Error('Invalid PDF envelope');
 return createHash('sha256').update(pdf).digest('hex');
}
