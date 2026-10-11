import {BadRequestException,Injectable,ServiceUnavailableException,UnauthorizedException} from '@nestjs/common';
import {ConfigService} from '@nestjs/config';
import {createHash} from 'node:crypto';
import {SalesCommercialService,commercialInput} from './sales-commercial.service';
import {CLICKSIGN_SANDBOX_API,signaturePdfHash,verifySignatureWebhook} from './sales-signature-protocol';
import {signatureDownloadOrigins,signatureDownloadUrl,signatureDownloadPdf} from './sales-signature-download';
import {SignatureContext,signatureFullProof,signatureResources,signatureWebhookEvent,signatureUuid} from './sales-signature-lifecycle.protocol';
@Injectable()
export class SalesSignatureLifecycleService{
 constructor(private readonly commercial:SalesCommercialService,private readonly config:ConfigService){}
 private enabled(){if(this.config.get('SALES_SIGNATURE_PREPARATION_ENABLED')!=='true'||this.config.get('SALES_SIGNATURE_LIFECYCLE_ENABLED')!=='true')throw new ServiceUnavailableException('Fluxo de assinatura desligado.');}
 private rpc(actor:string,action:string,body:unknown){this.enabled();return this.commercial.rpc('platform_sales_signature_lifecycle_action',{p_actor:actor,p_action:action,p_body:body});}
 private settings(flag:string){
  this.enabled();const token=this.config.get<string>('SALES_CLICKSIGN_SANDBOX_TOKEN');
  if(this.config.get(flag)!=='true'||this.config.get('SALES_CLICKSIGN_BASE_URL')!==CLICKSIGN_SANDBOX_API||typeof token!=='string'||token.length<20||token.length>500||/[\s\x00-\x1f\x7f]/.test(token))throw new ServiceUnavailableException('Chamadas sandbox desligadas.');
  return token;
 }
 private note(value:unknown){if(typeof value!=='string'||value.trim().length<20||value.length>1000||/[\x00-\x1f\x7f]/.test(value))throw new BadRequestException('Justificativa de 20 a 1000 caracteres necessária.');}
 private async request(path:string,token:string,method='GET',body?:unknown,parse=true){
  const response=await fetch(CLICKSIGN_SANDBOX_API+path,{method,headers:{Authorization:token,Accept:'application/vnd.api+json',...(body?{'Content-Type':'application/vnd.api+json'}:{})},body:body?JSON.stringify(body):undefined,redirect:'error',signal:AbortSignal.timeout(10000)});
  if(response.status!==200||!response.body)throw Error('Provider response unavailable');
  const chunks:Uint8Array[]=[];let size=0;const reader=response.body.getReader();
  try{for(;;){const r=await reader.read();if(r.done)break;size+=r.value.length;if(size>131072)throw Error('Oversize response');chunks.push(r.value);}}finally{await reader.cancel();}
  const bytes=Buffer.concat(chunks);return parse?JSON.parse(bytes.toString('utf8')):null;
 }
 private async observe(c:SignatureContext,token:string){
  const ids=signatureResources(c),path='/envelopes/'+ids[0];
  const parent=await this.request(path,token),documents=await this.request(path+'/documents',token),signers=await this.request(path+'/signers',token),requirements=await this.request(path+'/requirements',token),document=await this.request(path+'/documents/'+ids[1],token);
  const events=parent?.data?.attributes?.status==='closed'?await this.request(path+'/documents/'+ids[1]+'/events',token):undefined;
  return {proof:signatureFullProof(c,parent,documents,signers,requirements,document,events),document};
 }
 async read(actor:string,id:string,q:Record<string,unknown>={}){
  if(Object.keys(q).some(k=>k!=='page')||q.page!==undefined&&(typeof q.page!=='string'||!/^\d{1,4}$/.test(q.page))||Number(q.page??0)>1000)throw new BadRequestException('Página inválida.');
  const r=await this.rpc(actor,'read',commercialInput({id,page:Number(q.page??0)},['id','page'],['id'],['page']));
  const flags:Record<string,boolean>={reads:false,activation:false,notification:false};for(const [k,f] of Object.entries({reads:'SALES_SIGNATURE_LIFECYCLE_READ_CALLS_ENABLED',activation:'SALES_SIGNATURE_ACTIVATION_CALLS_ENABLED',notification:'SALES_SIGNATURE_NOTIFICATION_CALLS_ENABLED'}))try{this.settings(f);flags[k]=true;}catch{}
  return {...r,capabilities:flags};
 }
 async check(actor:string,body:unknown){
  const b=commercialInput(body,['id','requestId','eventHash','justification'],['id','requestId']);this.note(b.justification);
  if(b.eventHash!==null&&(typeof b.eventHash!=='string'||!/^[a-f0-9]{64}$/.test(b.eventHash)))throw new BadRequestException('Evento inválido.');
  const token=this.settings('SALES_SIGNATURE_LIFECYCLE_READ_CALLS_ENABLED');let origins:string[];
  try{origins=signatureDownloadOrigins(this.config.get('SALES_CLICKSIGN_SANDBOX_DOWNLOAD_ORIGINS'));}catch{throw new ServiceUnavailableException('Origens de PDF não configuradas.');}
  const c:SignatureContext=await this.rpc(actor,'check_begin',b);if(c.replayed)return c;
  let result:any;
  try{
   if(c.id!==b.id||c.requestId!==b.requestId)throw Error('Divergent reservation');
   const {proof,document}=await this.observe(c,token);let pdfHex:string|null=null;
   if(c.activationConfirmed&&proof.status==='DRAFT')throw Error('Activation state divergent');
   if(proof.status==='SIGNED'){
    const original=await signatureDownloadPdf(signatureDownloadUrl(document.data.links?.files?.original,origins));
    if(signaturePdfHash(original)!==c.draftSha256)throw Error('Remote original changed');
    const bytes=await signatureDownloadPdf(signatureDownloadUrl(document.data.links?.files?.signed,origins));
    if(signaturePdfHash(bytes)===c.draftSha256)throw Error('Unsigned source returned');pdfHex=bytes.toString('hex');
   }
   result={proof,pdfHex};
  }catch{await this.rpc(actor,'check_finish',{id:b.id,requestId:b.requestId,result:null});throw new ServiceUnavailableException('Conferência incompleta; histórico preservado.');}
  return this.rpc(actor,'check_finish',{id:b.id,requestId:b.requestId,result});
 }
 async command(actor:string,body:unknown){
  const b=commercialInput(body,['id','requestId','checkId','kind','justification'],['id','requestId','checkId']);this.note(b.justification);
  if(!['ACTIVATE','NOTIFY'].includes(b.kind))throw new BadRequestException('Comando inválido.');
  const token=this.settings(b.kind==='ACTIVATE'?'SALES_SIGNATURE_ACTIVATION_CALLS_ENABLED':'SALES_SIGNATURE_NOTIFICATION_CALLS_ENABLED');
  const c:SignatureContext=await this.rpc(actor,'command_reserve',b);if(c.replayed)return c;
  let observed:any;
  try{if(c.id!==b.id||c.requestId!==b.requestId)throw Error('Divergent reservation');observed=await this.observe(c,token);if(observed.proof.status!==(b.kind==='ACTIVATE'?'DRAFT':'RUNNING'))throw Error('State changed');}
  catch{await this.rpc(actor,'command_finish',{id:b.id,requestId:b.requestId,state:'NOT_SENT'});throw new ServiceUnavailableException('Recursos divergentes; comando não enviado.');}
  // Revalidate authority/source after GET and immediately before the effect. Failure leaves a reservation.
  await this.rpc(actor,'command_guard',{id:b.id,requestId:b.requestId});
  let state='UNKNOWN';
  try{
   const ids=signatureResources(c),path='/envelopes/'+ids[0];
   if(b.kind==='ACTIVATE'){
    const response=await this.request(path,token,'PATCH',{data:{id:ids[0],type:'envelopes',attributes:{status:'running',auto_close:true}}});
    if(response?.data?.id!==ids[0]||response.data.type!=='envelopes'||response.data.attributes?.status!=='running'||response.data.attributes?.auto_close!==true)throw Error('Uncertain activation');state='VERIFIED';
   }else{await this.request(path+'/notifications',token,'POST',{data:{type:'notifications',attributes:{message:'EnergyOS — homologação de assinatura. Assine apenas o documento de teste conferido.'}}},false);state='ACKNOWLEDGED';}
  }catch{/* A provider timeout never licenses another POST. */}
  const saved=await this.rpc(actor,'command_finish',{id:b.id,requestId:b.requestId,state});
  if(state==='UNKNOWN')throw new ServiceUnavailableException('Comando incerto. Reconferir sem reenviar.');return saved;
 }
 reconcile(actor:string,body:unknown){const b=commercialInput(body,['id','requestId','checkId','justification'],['id','requestId','checkId']);this.note(b.justification);return this.rpc(actor,'reconcile',b);}
 resolve(actor:string,body:unknown){const b=commercialInput(body,['id','requestId','justification'],['id','requestId']);this.note(b.justification);return this.rpc(actor,'resolve_check',b);}
 bridge(actor:string,body:unknown){const b=commercialInput(body,['id','requestId','checkId','justification'],['id','requestId','checkId']);this.note(b.justification);return this.rpc(actor,'bridge',b);}
 review(actor:string,body:unknown){const b=commercialInput(body,['id','documentId','requestId','expectedVersion','status','checks','justification'],['id','documentId','requestId'],['expectedVersion']);this.note(b.justification);return this.rpc(actor,'review',b);}
 async artifact(actor:string,id:string,checkId:string,kind:'PDF'|'LOG'){
  commercialInput({id,checkId},['id','checkId'],['id','checkId']);const r=await this.rpc(actor,'artifact',{id,checkId,kind});
  if(kind==='LOG')return Buffer.from(JSON.stringify(r.log,null,2),'utf8');
  if(typeof r.hex!=='string'||r.hex.length>2097152||!/^(?:[a-f0-9]{2})+$/.test(r.hex))throw new ServiceUnavailableException('Arquivo indisponível.');
  const bytes=Buffer.from(r.hex,'hex');if(signaturePdfHash(bytes)!==r.sha256)throw new ServiceUnavailableException('Integridade não confirmada.');return bytes;
 }
 async webhook(raw:Buffer|undefined,header:unknown){
  this.enabled();if(this.config.get('SALES_SIGNATURE_WEBHOOK_ENABLED')!=='true')throw new ServiceUnavailableException('Webhook desligado.');
  const secret=this.config.get('SALES_CLICKSIGN_SANDBOX_WEBHOOK_SECRET'),account=this.config.get<string>('SALES_CLICKSIGN_SANDBOX_ACCOUNT_KEY');
  if(!verifySignatureWebhook(raw as Buffer,header,secret))throw new UnauthorizedException('Webhook inválido.');
  let event:any;try{if(!account||!signatureUuid.test(account))throw Error();event=signatureWebhookEvent(raw!,account);}catch{throw new BadRequestException('Evento incompatível.');}
  return this.commercial.rpc('platform_sales_signature_receive_event',{p_event:{...event,rawHash:createHash('sha256').update(raw!).digest('hex')}});
 }
}
