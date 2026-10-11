import {BadRequestException,Injectable,ServiceUnavailableException} from '@nestjs/common';
import {ConfigService} from '@nestjs/config';
import {commercialInput,SalesCommercialService} from './sales-commercial.service';
import {CLICKSIGN_SANDBOX_API} from './sales-signature-protocol';
import {originalDocumentProof} from './sales-signature-document-proof';
import {signatureDownloadOrigins,signatureDownloadUrl,signatureDownloadPdf} from './sales-signature-download';

type OriginalClaim={id:string;requestId:string;envelopeId:string;documentId:string;draftSha256:string;replayed?:boolean};
@Injectable()
export class SalesSignatureOriginalService{
 constructor(private readonly commercial:SalesCommercialService,private readonly config:ConfigService){}
 private enabled(){if(this.config.get('SALES_SIGNATURE_PREPARATION_ENABLED')!=='true'||this.config.get('SALES_SIGNATURE_COMMANDS_ENABLED')!=='true'||this.config.get('SALES_SIGNATURE_ORIGINAL_ENABLED')!=='true')throw new ServiceUnavailableException('Conferência do PDF original desligada.');}
 private settings(){
  this.enabled();const token=this.config.get<string>('SALES_CLICKSIGN_SANDBOX_TOKEN');
  if(this.config.get('SALES_SIGNATURE_ORIGINAL_CALLS_ENABLED')!=='true'||this.config.get('SALES_CLICKSIGN_BASE_URL')!==CLICKSIGN_SANDBOX_API||typeof token!=='string'||token.length<20||token.length>500||/[\s\x00-\x1f\x7f]/.test(token))throw new ServiceUnavailableException('Consulta documental sandbox desligada.');
  try{return {token,origins:signatureDownloadOrigins(this.config.get('SALES_CLICKSIGN_SANDBOX_DOWNLOAD_ORIGINS'))};}catch{throw new ServiceUnavailableException('Origens autorizadas de download ainda não configuradas.');}
 }
 private rpc(actor:string,action:string,body:unknown){this.enabled();return this.commercial.rpc('platform_sales_signature_original_action',{p_actor:actor,p_action:action,p_body:body});}
 async read(actor:string,id:string,q:Record<string,unknown>={}){
  if(Object.keys(q).some(k=>k!=='page')||q.page!==undefined&&(typeof q.page!=='string'||!/^\d{1,4}$/.test(q.page)))throw new BadRequestException('Página inválida.');
  const page=Number(q.page??0);if(page>1000)throw new BadRequestException('Página inválida.');
  const value=await this.rpc(actor,'read',commercialInput({id,page},['id','page'],['id'],['page']));
  let callsEnabled=false;try{this.settings();callsEnabled=true;}catch{}
  return {...value,callsEnabled};
 }
 private async get(path:string,token:string):Promise<any>{
  const response=await fetch(CLICKSIGN_SANDBOX_API+path,{method:'GET',headers:{Authorization:token,Accept:'application/vnd.api+json'},redirect:'error',signal:AbortSignal.timeout(10000)});
  if(response.status!==200||!response.body)throw Error('Metadata unavailable');
  const reader=response.body.getReader(),chunks:Uint8Array[]=[];let size=0;
  try{for(;;){const r=await reader.read();if(r.done)break;size+=r.value.length;if(size>131072)throw Error('Oversize');chunks.push(r.value);}}finally{await reader.cancel();}
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
 }
 async check(actor:string,body:unknown){
  const b=commercialInput(body,['id','lease','candidateId','requestId','justification'],['id','lease','candidateId','requestId']);
  if(typeof b.justification!=='string'||b.justification.trim().length<20||b.justification.length>1000||/[\x00-\x1f\x7f]/.test(b.justification))throw new BadRequestException('Justificativa inválida.');
  const {token,origins}=this.settings(),c:OriginalClaim=await this.rpc(actor,'begin',b);
  if(c.replayed)return c;
  let proof:unknown=null;
  try{
   const uuid=/^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
   if(![c.id,c.envelopeId,c.documentId].every(x=>typeof x==='string'&&uuid.test(x))||c.id!==b.id||c.documentId!==b.candidateId)throw Error('Invalid source');
   const parent=await this.get('/envelopes/'+c.envelopeId,token);
   const document=await this.get('/envelopes/'+c.envelopeId+'/documents/'+c.documentId,token);
   const context={signatureId:c.id,envelopeId:c.envelopeId,documentId:c.documentId,draftSha256:c.draftSha256};
   // Reject divergent metadata before transferring a signed URL to a storage origin.
   if(parent?.data?.id!==c.envelopeId||parent.data.type!=='envelopes'||parent.data.attributes?.status!=='draft'||parent.data.attributes?.name!==`EnergyOS HOMOLOGAÇÃO ${c.id}`||document?.data?.id!==c.documentId||document.data.type!=='documents'||document.data.attributes?.status!=='draft'||document.data.attributes?.filename!==`energyos-sandbox-${c.id}.pdf`)throw Error('Metadata mismatch');
   const url=signatureDownloadUrl(document.data.links?.files?.original,origins);
   const pdf=await signatureDownloadPdf(url);
   proof=originalDocumentProof(context,parent,document,pdf);
  }catch{
   await this.rpc(actor,'complete',{id:b.id,requestId:b.requestId,result:null});
   throw new ServiceUnavailableException('Conferência documental incompleta; bloqueio e histórico preservados.');
  }
  return this.rpc(actor,'complete',{id:b.id,requestId:b.requestId,result:proof});
 }
}
