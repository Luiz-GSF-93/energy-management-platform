import {BadRequestException,ConflictException,ForbiddenException,Injectable,OnModuleDestroy,OnModuleInit,ServiceUnavailableException} from '@nestjs/common';
import {randomUUID} from 'node:crypto';
import {SupabaseService} from '../../services/supabase.service';
import {TenantContext} from '../../common/interfaces/tenant-context.interface';
import {generateSupportCode,supportCodeHash,supportEmail,supportInput,SUPPORT_ACTIONS} from './central-support.model';

@Injectable()
export class CentralSupportService implements OnModuleInit,OnModuleDestroy{
 private timer?:ReturnType<typeof setInterval>;private running=false;
 constructor(private readonly db:SupabaseService){}
 onModuleInit(){this.timer=setInterval(()=>void this.tick(),15000);this.timer.unref?.();}
 onModuleDestroy(){if(this.timer)clearInterval(this.timer);}
 private async rpc(name:string,args:Record<string,unknown>){
  let result:any;try{result=await this.db.getClient().rpc(name,args);}catch{throw new ServiceUnavailableException('Atendimento indisponível. Confira o protocolo antes de repetir.');}
  if(result.error?.code==='42501')throw new ForbiddenException('Acesso ou autorização de atendimento não permitidos.');
  if(['40001','23505'].includes(result.error?.code))throw new ConflictException('Os dados mudaram. Atualize e confira o chamado antes de repetir.');
  if(['22023','23514','22P02','23503'].includes(result.error?.code))throw new BadRequestException('Confira a configuração de atendimento da licença, os campos e a autorização.');
  if(result.error||result.data==null)throw new ServiceUnavailableException('Atendimento não confirmado. Atualize o histórico antes de repetir.');
  return result.data;
 }
 private identity(t:TenantContext){if(!t?.organizationId||!t.userId||t.accessMode||!['admin_org','gestor','operacional'].includes(t.role))throw new ForbiddenException('Use sua conta interna da organização.');}
 async list(t:TenantContext,page=0){this.identity(t);return this.rpc('central_support_action',{o:t.organizationId,a:t.userId,x:'list',i:null,b:{page}});}
 async action(t:TenantContext,action:'draft'|'authorize'|'submit',id:string,input:unknown){
  this.identity(t);const body=supportInput(action,input);let code:string|undefined;
  if(action==='authorize'||action==='submit'){
   const secret=process.env.CENTRAL_SUPPORT_CODE_SECRET;if(!secret||secret.length<32)throw new ServiceUnavailableException('Liberação de chamados ainda não configurada.');
   if(action==='authorize')code=generateSupportCode();
   body.codeHash=supportCodeHash(secret,t.organizationId,id,code??body.code);delete body.code;
  }
  const result=await this.rpc('central_support_action',{o:t.organizationId,a:t.userId,x:action,i:id,b:body});
  if(result.error)throw new ConflictException(result.message||'Confira a autorização antes de enviar.');
  return {...result,...(code?{code}:{} )};
 }
 platform(actor:string,action:'list'|'policy_read'|'policy'|'activate'|'triage'|'reply'|'retry_email',id:string|null,input:unknown={}){
  const body=action==='list'||action==='policy_read'?input:supportInput(action as keyof typeof SUPPORT_ACTIONS,input);
  return this.rpc('central_support_platform',{a:actor,x:action,i:id,b:body});
 }
 async tick(){
  if(this.running||process.env.CENTRAL_SUPPORT_EMAIL_ENABLED!=='true'||!process.env.RESEND_API_KEY)return;
  this.running=true;let row:any,posted=false;const lease=randomUUID();
  try{
   row=await this.rpc('central_support_delivery',{x:'claim',i:lease,b:{}});if(!row.id)return;
   const content=supportEmail(row.payload);
   posted=true;const response=await fetch('https://api.resend.com/emails',{method:'POST',redirect:'error',signal:AbortSignal.timeout(15000),
    headers:{Authorization:'Bearer '+process.env.RESEND_API_KEY,'Content-Type':'application/json','Idempotency-Key':'central-support/'+row.id},
    body:JSON.stringify({from:process.env.MEMBERSHIP_EMAIL_FROM||'EnergyOS <nao-responda@notificacoes.expertenergy.com.br>',to:row.recipients,...content})});
   const receipt=response.ok?await response.json() as any:null;
   const state=typeof receipt?.id==='string'?'ACCEPTED':[400,401,403,422].includes(response.status)?'FAILED':'UNKNOWN';
   await this.rpc('central_support_delivery',{x:'finish',i:row.id,b:{lease,state,providerId:receipt?.id??null}});
  }catch{if(row?.id)await this.rpc('central_support_delivery',{x:'finish',i:row.id,b:{lease,state:posted?'UNKNOWN':'FAILED',providerId:null}}).catch(()=>undefined);}
  finally{this.running=false;}
 }
}
