import {BadRequestException,Injectable,ServiceUnavailableException} from '@nestjs/common';
import {ConfigService} from '@nestjs/config';
import {randomUUID} from 'node:crypto';
import {commercialInput,SalesCommercialService} from './sales-commercial.service';
import {CLICKSIGN_SANDBOX_API,signatureEnvelope} from './sales-signature-protocol';
import {SalesSignatureAdapter,signatureOperation,SignatureClaim,SignatureDispatchFailure} from './sales-signature.adapter';
import {absencePage,AbsenceProof,signatureUuid} from './sales-signature-absence.protocol';
type Source={id:string;lease:string;accountKey:string};
@Injectable()
export class SalesSignatureAbsenceService {
 constructor(private readonly commercial:SalesCommercialService,private readonly config:ConfigService,private readonly adapter:SalesSignatureAdapter){}
 private enabled(){for(const key of ['SALES_SIGNATURE_PREPARATION_ENABLED','SALES_SIGNATURE_COMMANDS_ENABLED','SALES_SIGNATURE_ABSENCE_ENABLED'])if(this.config.get(key)!=='true')throw new ServiceUnavailableException('Recuperação por ausência desligada.');}
 private rpc(actor:string,action:string,body:unknown){this.enabled();return this.commercial.rpc('platform_sales_signature_absence_action',{p_actor:actor,p_action:action,p_body:body});}
 private transport(){
  this.enabled();const token=this.config.get<string>('SALES_CLICKSIGN_SANDBOX_TOKEN'),accountKey=this.config.get<string>('SALES_CLICKSIGN_SANDBOX_ACCOUNT_KEY');
  if(this.config.get('SALES_SIGNATURE_ABSENCE_CALLS_ENABLED')!=='true'||this.config.get('SALES_CLICKSIGN_BASE_URL')!==CLICKSIGN_SANDBOX_API||typeof token!=='string'||token.length<20||token.length>500||/[\s\x00-\x1f\x7f]/.test(token)||!accountKey||!signatureUuid.test(accountKey))throw new ServiceUnavailableException('Reconferência sandbox desligada ou conta não configurada.');
  return {token,accountKey};
 }
 private note(value:unknown){if(typeof value!=='string'||value.trim().length<20||value.length>1000||/[\x00-\x1f\x7f]/.test(value))throw new BadRequestException('Justificativa inválida.');}
 async read(actor:string,id:string,q:Record<string,unknown>={}){if(Object.keys(q).some(k=>k!=='page')||q.page!==undefined&&(typeof q.page!=='string'||!/^\d{1,4}$/.test(q.page)))throw new BadRequestException('Página inválida.');const page=Number(q.page??0);if(page>1000)throw new BadRequestException('Página inválida.');const v=await this.rpc(actor,'read',commercialInput({id,page},['id','page'],['id'],['page']));let callsEnabled=false;try{this.transport();callsEnabled=true;}catch{}return {...v,callsEnabled,executionEnabled:callsEnabled&&this.config.get('SALES_SIGNATURE_ABSENCE_APPLICATION_ENABLED')==='true'};}
 private async scan(source:Source):Promise<AbsenceProof>{
  const {token,accountKey}=this.transport();if(source.accountKey!==accountKey)throw new ServiceUnavailableException('Conta diverge da evidência preservada.');
  const name=signatureEnvelope(source.id).data.attributes.name,seen=new Set<string>(),urls=new Set<string>();
  let url:string|null=CLICKSIGN_SANDBOX_API+'/envelopes?'+new URLSearchParams({'filter[name]':name}),pages=0;
  try{
   const signal=AbortSignal.timeout(15000);
   while(url){
    if(pages>=20||urls.has(url))throw Error('PAGINATION');urls.add(url);
    const response=await fetch(url,{method:'GET',headers:{Authorization:token,Accept:'application/vnd.api+json'},redirect:'error',signal});
    if(response.status!==200||!response.body)throw Error('HTTP');
    const reader=response.body.getReader(),chunks:Uint8Array[]=[];let size=0;
    try{for(;;){const item=await reader.read();if(item.done)break;size+=item.value.length;if(size>131072)throw Error('FORMAT');chunks.push(item.value);}}finally{await reader.cancel();}
    let raw:unknown;try{raw=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{throw Error('FORMAT');}
    const page=absencePage(raw,name,seen);if(seen.size>100)throw Error('FORMAT');pages++;url=page.next;
   }
   return {state:seen.size?'CANDIDATE':'EMPTY',pages,candidateIds:[...seen],reason:null};
  }catch(e){const message=e instanceof Error?e.message:'';return {state:'INCOMPLETE',pages,candidateIds:[],reason:['HTTP','FORMAT','PAGINATION'].includes(message)?message:e instanceof Error&&['TimeoutError','AbortError'].includes(e.name)?'TIMEOUT':'NETWORK'};}
 }
 async check(actor:string,body:unknown){
  const b=commercialInput(body,['id','lease','requestId','justification'],['id','lease','requestId']);this.note(b.justification);
  const {accountKey}=this.transport(),source=await this.rpc(actor,'begin',{...b,accountKey});if(source.replayed)return source;
  const proof=await this.scan(source);return this.rpc(actor,'complete',{id:b.id,requestId:b.requestId,proof});
 }
 async authorize(actor:string,body:unknown){const b=commercialInput(body,['id','checkId','resolutionId','providerReference','accountKey','justification'],['id','checkId','resolutionId','accountKey']);this.note(b.justification);if(typeof b.providerReference!=='string'||!/^[-a-zA-Z0-9_./: ]{8,160}$/.test(b.providerReference))throw new BadRequestException('Informe a referência da confirmação escrita do fornecedor.');return this.rpc(actor,'authorize',b);}
 async reject(actor:string,body:unknown){const b=commercialInput(body,['id','resolutionId','justification'],['id','resolutionId']);this.note(b.justification);return this.rpc(actor,'reject',b);}
 async execute(actor:string,body:unknown){
  const b=commercialInput(body,['id','resolutionId','justification'],['id','resolutionId']);this.note(b.justification);this.transport();
  if(this.config.get('SALES_SIGNATURE_ABSENCE_APPLICATION_ENABLED')!=='true')throw new ServiceUnavailableException('Aplicação da recuperação desligada.');this.adapter.assertEnabled();
  // Reserve an execution check before GET. A lost RPC response must never lead to a POST.
  const requestId=randomUUID(),source=await this.rpc(actor,'executionCheck',{...b,requestId});
  const proof=await this.scan(source);await this.rpc(actor,'complete',{id:b.id,requestId,proof});
  if(proof.state!=='EMPTY')throw new ServiceUnavailableException('Ausência não confirmada; nenhum reenvio.');
  const lease=randomUUID(),claim:SignatureClaim=await this.rpc(actor,'consume',{...b,requestId,lease});
  try{signatureOperation(claim);}catch{await this.commercial.rpc('platform_sales_signature_dispatch_action',{p_actor:actor,p_action:'abort',p_body:{id:b.id,lease}});throw new ServiceUnavailableException('Fonte incompleta; nenhum envio.');}
  await this.commercial.rpc('platform_sales_signature_dispatch_action',{p_actor:actor,p_action:'reserve',p_body:{id:b.id,lease}});
  let result:unknown;try{result=await this.adapter.dispatch(claim);}catch(e){await this.commercial.rpc('platform_sales_signature_dispatch_action',{p_actor:actor,p_action:'finish',p_body:{id:b.id,lease,result:null}});if(e instanceof SignatureDispatchFailure)await this.rpc(actor,'diagnostic',{id:b.id,lease,reason:e.diagnosticReason,httpStatus:e.diagnosticHttpStatus});throw new ServiceUnavailableException('Nova tentativa incerta preservada; sem repetição automática.');}
  return this.commercial.rpc('platform_sales_signature_dispatch_action',{p_actor:actor,p_action:'finish',p_body:{id:b.id,lease,result}});
 }
}
