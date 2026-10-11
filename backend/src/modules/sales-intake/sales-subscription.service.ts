import {BadRequestException,ConflictException,ForbiddenException,Injectable,NotFoundException,ServiceUnavailableException} from '@nestjs/common';
import {ConfigService} from '@nestjs/config';
import {randomUUID} from 'node:crypto';
import {SupabaseService} from '../../services/supabase.service';
import {commercialInput} from './sales-commercial.service';
import {SalesSubscriptionAdapter} from './sales-subscription.adapter';

@Injectable()
export class SalesSubscriptionService {
 constructor(private readonly db:SupabaseService,private readonly config:ConfigService,private readonly adapter:SalesSubscriptionAdapter){}
 private async rpc(actor:string,action:string,body:unknown):Promise<any>{
  if(this.config.get('SALES_SUBSCRIPTION_COMMANDS_ENABLED')!=='true'||this.config.get('SALES_RECURRENCE_PREPARATION_ENABLED')!=='true')throw new ServiceUnavailableException('Comandos privados de recorrência desligados.');
  let r:any;try{r=await this.db.getClient().rpc('platform_sales_subscription_command_action',{p_actor:actor,p_action:action,p_body:body});}catch{throw new ServiceUnavailableException('Comando indisponível; preserve o registro e concilie.');}
  if(r.error){if(r.error.code==='42501')throw new ForbiddenException('Perfil sem autorização.');if(['P3670','P3610'].includes(r.error.code))throw new NotFoundException('Fonte não localizada.');if(['P3671','P3611','23505'].includes(r.error.code))throw new ConflictException('Comando ou fonte divergente; não repita envio.');if(['22023','22P02','22007','22008','23514','22003'].includes(r.error.code))throw new BadRequestException('Dados inválidos.');throw new ServiceUnavailableException('Comando indisponível; preserve o registro e concilie.');}
  return r.data;
 }
 private id(agreementId:string){commercialInput({agreementId},['agreementId'],['agreementId']);}
 private note(body:unknown){const b=commercialInput(body,['justification'],[]);if(typeof b.justification!=='string'||b.justification.trim().length<20||b.justification.length>500)throw new BadRequestException('Justificativa exigida.');return b.justification;}
 private calls(){if(this.config.get('SALES_SUBSCRIPTION_CALLS_ENABLED')!=='true')throw new ServiceUnavailableException('Chamadas sandbox desligadas.');}
 async read(actor:string,agreementId:string){this.id(agreementId);const r=await this.rpc(actor,'read',{agreementId});return {...r,externalCallsEnabled:this.config.get('SALES_SUBSCRIPTION_CALLS_ENABLED')==='true'};}
 prepare(actor:string,agreementId:string,body:unknown){this.id(agreementId);const b=commercialInput(body,['id','justification'],['id']);const justification=this.note({justification:b.justification});return this.rpc(actor,'prepare',{agreementId,id:b.id,justification});}
 async execute(actor:string,agreementId:string,body:unknown){
  this.id(agreementId);const justification=this.note(body);this.calls();
  const source=await this.rpc(actor,'authorize',{agreementId});
  if(source.state!=='PREPARED')throw new ConflictException('Tentativa já reservada; somente conciliação permitida.');
  const proof=await this.adapter.absenceProof(source.parameters);
  const reserved=await this.rpc(actor,'reserve',{agreementId,requestId:randomUUID(),evidence:{...proof,checkedAt:new Date().toISOString()},justification});
  // If persistence fails or its response is lost, no POST is attempted.
  // A reservation can never be reused, even after a timeout or process crash.
  let summary;try{summary=await this.adapter.dispatchReserved(reserved.parameters);}catch{
   try{await this.rpc(actor,'ambiguous',{agreementId,requestId:randomUUID(),evidence:{},justification:'Resultado externo incerto; somente conciliação por consulta, sem repetição de envio.'});}catch{/* POST_RESERVED also blocks any repeated dispatch. */}
   throw new ServiceUnavailableException('Resultado incerto; concilie sem repetir envio.');
  }
  await this.rpc(actor,'finish',{agreementId,requestId:randomUUID(),evidence:summary,justification});
  return this.read(actor,agreementId);
 }
 async reconcile(actor:string,agreementId:string,body:unknown){
  this.id(agreementId);const justification=this.note(body);this.calls();
  const source=await this.rpc(actor,'authorize',{agreementId});
  if(!['POST_RESERVED','AMBIGUOUS'].includes(source.state))throw new ConflictException('Nenhuma tentativa pendente de conciliação.');
  const summary=await this.adapter.reconcile(source.parameters);
  await this.rpc(actor,'reconcile',{agreementId,requestId:randomUUID(),evidence:summary,justification});
  return this.read(actor,agreementId);
 }
}
