import {BadRequestException,Injectable,ServiceUnavailableException} from '@nestjs/common';
import {ConfigService} from '@nestjs/config';
import {randomUUID} from 'node:crypto';
import {SalesCommercialService,commercialInput} from './sales-commercial.service';
import {SalesSignatureAdapter,signatureOperation,SignatureDispatchFailure} from './sales-signature.adapter';
@Injectable()
export class SalesSignatureDispatchService {
 constructor(private readonly commercial:SalesCommercialService,private readonly config:ConfigService,private readonly adapter:SalesSignatureAdapter){}
 private enabled(){if(this.config.get('SALES_SIGNATURE_PREPARATION_ENABLED')!=='true'||this.config.get('SALES_SIGNATURE_COMMANDS_ENABLED')!=='true')throw new ServiceUnavailableException('Comandos Clicksign sandbox desligados.');}
 private rpc(actor:string,action:string,body:unknown){this.enabled();return this.commercial.rpc('platform_sales_signature_dispatch_action',{p_actor:actor,p_action:action,p_body:body});}
 async read(actor:string,id:string){const value=await this.rpc(actor,'read',commercialInput({id},['id'],['id']));let callsEnabled=false;try{this.adapter.assertEnabled();callsEnabled=true;}catch{}return {...value,callsEnabled};}
 async next(actor:string,body:unknown){
  const b=commercialInput(body,['id','expectedOrdinal','justification'],['id'],['expectedOrdinal']);
  if(b.expectedOrdinal<1||b.expectedOrdinal>8||typeof b.justification!=='string'||b.justification.trim().length<20||b.justification.length>1000||/[\x00-\x1f\x7f]/.test(b.justification))throw new BadRequestException('Passo e justificativa inválidos.');
  this.enabled();this.adapter.assertEnabled();
  const lease=randomUUID(),claim=await this.rpc(actor,'claim',{...b,lease});
  try{signatureOperation(claim);}catch{
   await this.rpc(actor,'abort',{id:b.id,lease});throw new ServiceUnavailableException('Fonte incompleta; nenhum envio externo reservado.');
  }
  // If reservation fails or its response is lost, POST must not run.
  await this.rpc(actor,'reserve',{id:b.id,lease});
  let result:unknown;
  try{result=await this.adapter.dispatch(claim);}catch(e){
   await this.rpc(actor,'finish',{id:b.id,lease,result:null});
   if(e instanceof SignatureDispatchFailure&&this.config.get('SALES_SIGNATURE_ABSENCE_ENABLED')==='true')await this.commercial.rpc('platform_sales_signature_absence_action',{p_actor:actor,p_action:'diagnostic',p_body:{id:b.id,lease,reason:e.diagnosticReason,httpStatus:e.diagnosticHttpStatus}});
   throw new ServiceUnavailableException('Tentativa incerta preservada; não repetir criação.');
  }
  // A failed finish leaves a reservation, preventing a second POST even if the provider succeeded.
  return this.rpc(actor,'finish',{id:b.id,lease,result});
 }
}
