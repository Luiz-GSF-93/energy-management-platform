import {Injectable,ServiceUnavailableException} from '@nestjs/common';
import {ConfigService} from '@nestjs/config';
import {CLICKSIGN_SANDBOX_API,signatureEnvelope,signaturePdfHash} from './sales-signature-protocol';
export const SIGNATURE_STEPS=['ENVELOPE','DOCUMENT','SUPPLIER','CUSTOMER','QUAL_SUPPLIER','AUTH_SUPPLIER','QUAL_CUSTOMER','AUTH_CUSTOMER'] as const;
export type SignatureStep=typeof SIGNATURE_STEPS[number];
export type SignatureClaim={id:string;lease:string;step:SignatureStep;ordinal:number;source:{draftSha256:string;parties:{supplier:{signatory:string;email:string};customer:{signatory:string;email:string}};pdfHex?:string};dependencies:{envelope?:string;document?:string;supplier?:string;customer?:string}};
const uuid=/^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
export function signatureOperation(c:SignatureClaim){
 if(!c||!uuid.test(c.id)||!uuid.test(c.lease)||SIGNATURE_STEPS[c.ordinal-1]!==c.step)throw new Error('Invalid claim');
 const env=c.dependencies?.envelope;
 if(c.step==='ENVELOPE')return {path:'/envelopes',body:signatureEnvelope(c.id)};
 if(!env||!uuid.test(env))throw new Error('Invalid envelope');
 const path='/envelopes/'+env;
 if(c.step==='DOCUMENT'){
  if(typeof c.source.pdfHex!=='string'||c.source.pdfHex.length>2097152||!/^([a-f0-9]{2})+$/.test(c.source.pdfHex))throw new Error('Invalid source PDF');
  const pdf=Buffer.from(c.source.pdfHex,'hex');if(signaturePdfHash(pdf)!==c.source.draftSha256)throw new Error('Source hash mismatch');
  return {path:path+'/documents',body:{data:{type:'documents',attributes:{filename:`energyos-sandbox-${c.id}.pdf`,content_base64:'data:application/pdf;base64,'+pdf.toString('base64')}}}};
 }
 const party=c.source?.parties?.[c.step.includes('SUPPLIER')?'supplier':'customer'];
 if(!party||typeof party.signatory!=='string'||party.signatory.trim().length<3||party.signatory.length>200||/[\x00-\x1f\x7f]/.test(party.signatory)||typeof party.email!=='string'||party.email.length>254||!/^\S+@[^\s@]+\.[^\s@]+$/.test(party.email))throw new Error('Invalid signer');
 if(c.step==='SUPPLIER'||c.step==='CUSTOMER')return {path:path+'/signers',body:{data:{type:'signers',attributes:{name:party.signatory,email:party.email,has_documentation:false,refusable:true}}}};
 const doc=c.dependencies.document,signer=c.dependencies[c.step.includes('SUPPLIER')?'supplier':'customer'];
 if(!doc||!signer||!uuid.test(doc)||!uuid.test(signer))throw new Error('Invalid requirement relationship');
 return {path:path+'/requirements',body:{data:{type:'requirements',attributes:c.step.startsWith('QUAL_')?{action:'agree',role:'sign'}:{action:'provide_evidence',auth:'email'},relationships:{document:{data:{type:'documents',id:doc}},signer:{data:{type:'signers',id:signer}}}}}};
}
export function signatureOperationResult(c:SignatureClaim,raw:unknown){
 const expected=signatureOperation(c).body.data,v=(raw as any)?.data;
 if(!v||typeof v.id!=='string'||!uuid.test(v.id)||v.type!==expected.type||!v.attributes)throw new Error('Invalid response');
 const a=v.attributes,e=expected.attributes as any;
 if(c.step==='ENVELOPE'&&(a.name!==e.name||a.status!=='draft'))throw new Error('Envelope mismatch');
 if(c.step==='DOCUMENT'&&a.filename!==e.filename)throw new Error('Document mismatch');
 if(['SUPPLIER','CUSTOMER'].includes(c.step)&&(a.name!==e.name||a.email!==e.email))throw new Error('Signer mismatch');
 if(c.step.startsWith('QUAL_')||c.step.startsWith('AUTH_')){
  if(a.action!==e.action||c.step.startsWith('QUAL_')&&a.role!==e.role||c.step.startsWith('AUTH_')&&a.auth!==e.auth)throw new Error('Requirement mismatch');
  for(const kind of ['document','signer'])if(v.relationships?.[kind]?.data?.id!==(expected as any).relationships[kind].data.id||v.relationships[kind].data.type!==(expected as any).relationships[kind].data.type)throw new Error('Relationship mismatch');
 }
 return {externalId:v.id,type:v.type};
}
@Injectable()
export class SalesSignatureAdapter {
 constructor(private readonly config:ConfigService){}
 assertEnabled(){
  const token=this.config.get<string>('SALES_CLICKSIGN_SANDBOX_TOKEN');
  if(this.config.get('SALES_SIGNATURE_PREPARATION_ENABLED')!=='true'||this.config.get('SALES_SIGNATURE_COMMANDS_ENABLED')!=='true'||this.config.get('SALES_SIGNATURE_CALLS_ENABLED')!=='true'||this.config.get('SALES_CLICKSIGN_BASE_URL')!==CLICKSIGN_SANDBOX_API||typeof token!=='string'||token.length<20||token.length>500||/[\s\x00-\x1f\x7f]/.test(token))throw new ServiceUnavailableException('Criação Clicksign sandbox desligada.');
  return token;
 }
 // Exactly one POST. The caller must persist reservation before reaching this method.
 async dispatch(c:SignatureClaim){
  const token=this.assertEnabled(),op=signatureOperation(c);
  try{
   const response=await fetch(CLICKSIGN_SANDBOX_API+op.path,{method:'POST',headers:{Authorization:token,Accept:'application/vnd.api+json','Content-Type':'application/vnd.api+json'},body:JSON.stringify(op.body),redirect:'error',signal:AbortSignal.timeout(10000)});
   if(response.status!==201||!response.body)throw new Error('Unexpected HTTP');
   const reader=response.body.getReader(),chunks:Uint8Array[]=[];let size=0;
   try{for(;;){const r=await reader.read();if(r.done)break;size+=r.value.length;if(size>131072)throw new Error('Response too large');chunks.push(r.value);}}finally{await reader.cancel();}
   return signatureOperationResult(c,JSON.parse(Buffer.concat(chunks).toString('utf8')));
  }catch{throw new ServiceUnavailableException('Resultado Clicksign incerto; criação bloqueada para reconferência, sem reenvio automático.');}
 }
}
