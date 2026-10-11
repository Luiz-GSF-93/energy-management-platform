import {Injectable,ServiceUnavailableException,BadRequestException} from '@nestjs/common';
import {ConfigService} from '@nestjs/config';
import {commercialInput,SalesCommercialService} from './sales-commercial.service';
import {CLICKSIGN_SANDBOX_API} from './sales-signature-protocol';
import {SignatureClaim,signatureOperation,signatureOperationResult} from './sales-signature.adapter';
type Recovery=SignatureClaim&{requestId:string;candidateId:string};
const uuid=/^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
@Injectable()
export class SalesSignatureRecoveryService {
 constructor(private readonly commercial:SalesCommercialService,private readonly config:ConfigService){}
 private enabled(){if(this.config.get('SALES_SIGNATURE_PREPARATION_ENABLED')!=='true'||this.config.get('SALES_SIGNATURE_COMMANDS_ENABLED')!=='true'||this.config.get('SALES_SIGNATURE_RECOVERY_ENABLED')!=='true')throw new ServiceUnavailableException('Reconferência Clicksign desligada.');}
 private token(){this.enabled();const token=this.config.get<string>('SALES_CLICKSIGN_SANDBOX_TOKEN');if(this.config.get('SALES_SIGNATURE_RECOVERY_CALLS_ENABLED')!=='true'||this.config.get('SALES_CLICKSIGN_BASE_URL')!==CLICKSIGN_SANDBOX_API||typeof token!=='string'||token.length<20||token.length>500||/[\s\x00-\x1f\x7f]/.test(token))throw new ServiceUnavailableException('Consultas Clicksign sandbox desligadas.');return token;}
 private rpc(actor:string,action:string,body:unknown){this.enabled();return this.commercial.rpc('platform_sales_signature_recovery_action',{p_actor:actor,p_action:action,p_body:body});}
 async read(actor:string,id:string,q:Record<string,unknown>={}){if(Object.keys(q).some(k=>k!=='page')||q.page!==undefined&&(typeof q.page!=='string'||!/^\d{1,4}$/.test(q.page)))throw new BadRequestException('Página inválida.');const page=Number(q.page??0);if(page>1000)throw new BadRequestException('Página inválida.');const v=await this.rpc(actor,'read',commercialInput({id,page},['id','page'],['id'],['page']));let callsEnabled=false;try{this.token();callsEnabled=true;}catch{}return {...v,callsEnabled};}
 private async get(path:string,token:string){
  const response=await fetch(CLICKSIGN_SANDBOX_API+path,{method:'GET',headers:{Authorization:token,Accept:'application/vnd.api+json'},redirect:'error',signal:AbortSignal.timeout(10000)});
  if(response.status!==200||!response.body)throw Error('Incomplete GET');
  const reader=response.body.getReader(),chunks:Uint8Array[]=[];let size=0;
  try{for(;;){const v=await reader.read();if(v.done)break;size+=v.value.length;if(size>131072)throw Error('Oversize');chunks.push(v.value);}}finally{await reader.cancel();}
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
 }
 async check(actor:string,body:unknown){
  const b=commercialInput(body,['id','lease','requestId','candidateId','justification'],['id','lease','requestId','candidateId']);
  if(typeof b.justification!=='string'||b.justification.trim().length<20||b.justification.length>1000||/[\x00-\x1f\x7f]/.test(b.justification))throw new BadRequestException('Justificativa inválida.');
  const token=this.token(),c:Recovery=await this.rpc(actor,'begin',b);
  if((c as any).replayed)return c;
  let result:unknown=null;
  try{
   if(!uuid.test(c.candidateId)||c.ordinal===2)throw Error('Document byte proof pending');
   const op=signatureOperation(c);
   if(c.ordinal!==1){
    const env=c.dependencies.envelope!;
    const parent=await this.get('/envelopes/'+env,token);
    signatureOperationResult({...c,ordinal:1,step:'ENVELOPE'},{data:parent.data});
    if(parent.data.id!==env)throw Error('Envelope mismatch');
   }
   const raw=await this.get(op.path+'/'+c.candidateId,token);
   if(raw?.data?.id!==c.candidateId)throw Error('Candidate mismatch');
   result=signatureOperationResult(c,raw);
  }catch{
   await this.rpc(actor,'complete',{id:b.id,requestId:b.requestId,result:null});
   throw new ServiceUnavailableException('Reconferência incompleta ou divergente; bloqueio preservado, sem novo envio.');
  }
  return this.rpc(actor,'complete',{id:b.id,requestId:b.requestId,result});
 }
}
