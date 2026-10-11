import {signaturePdfHash} from './sales-signature-protocol';

const uuid=/^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
export type OriginalDocumentContext={signatureId:string;envelopeId:string;documentId:string;draftSha256:string};

/** Pure comparison only. No network, persistence, signature acceptance or recovery capability.
 * Bytes must eventually come from an independently validated sandbox transport, never a
 * client upload substituted for remote bytes. Do not wire this helper into recovery alone.
 */
export function originalDocumentProof(context:OriginalDocumentContext,parent:unknown,document:unknown,pdf:Buffer){
 if(!context||![context.signatureId,context.envelopeId,context.documentId].every(v=>typeof v==='string'&&uuid.test(v))||typeof context.draftSha256!=='string'||! /^[a-f0-9]{64}$/.test(context.draftSha256))throw Error('Invalid original document context');
 const envelope=(parent as any)?.data,remote=(document as any)?.data;
 if(envelope?.id!==context.envelopeId||envelope?.type!=='envelopes'||envelope?.attributes?.status!=='draft'||envelope?.attributes?.name!==`EnergyOS HOMOLOGAÇÃO ${context.signatureId}`)throw Error('Original document envelope mismatch');
 if(remote?.id!==context.documentId||remote?.type!=='documents'||remote?.attributes?.status!=='draft'||remote?.attributes?.filename!==`energyos-sandbox-${context.signatureId}.pdf`)throw Error('Original document metadata mismatch');
 // Metadata URLs are deliberately not read or returned. The accepted transport origin is
 // not established yet; a name/URL/provider checksum cannot stand in for actual PDF bytes.
 if(!Buffer.isBuffer(pdf)||pdf.length>1048576)throw Error('Original document size invalid');
 const sha256=signaturePdfHash(pdf);
 if(sha256!==context.draftSha256)throw Error('Original document bytes mismatch');
 return {externalId:context.documentId,type:'documents' as const,envelopeId:context.envelopeId,sha256,byteLength:pdf.length,environment:'SANDBOX' as const,realActivationEligible:false as const};
}
