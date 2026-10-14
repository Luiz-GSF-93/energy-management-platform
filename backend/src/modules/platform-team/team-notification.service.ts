import {BadRequestException,ForbiddenException,Injectable,OnModuleDestroy,OnModuleInit,ServiceUnavailableException} from '@nestjs/common';
import {randomUUID} from 'node:crypto';
import {SupabaseService} from '../../services/supabase.service';
import {TEAM_FROM,TEAM_SUBJECT,teamVariables,templateSnapshot,verifyTeamWebhook} from './team-notification.security';
import {TEAM_TEMPLATE_SNAPSHOT} from './team-notification.template';
const enabled=(key:string)=>process.env[key]==='true';
@Injectable()
export class TeamNotificationService implements OnModuleInit,OnModuleDestroy{
 private timer?:ReturnType<typeof setInterval>;private running=false;
 constructor(private readonly db:SupabaseService){}
 onModuleInit(){this.timer=setInterval(()=>void this.tick().catch(()=>undefined),60000);this.timer.unref?.();}
 onModuleDestroy(){if(this.timer)clearInterval(this.timer);}
 private gate(){if(!enabled('PLATFORM_TEAM_NOTIFICATIONS_ENABLED'))throw new ServiceUnavailableException('Acompanhamento de avisos da equipe desligado; aguardando homologação.');}
 private async rpc(name:string,args:Record<string,unknown>){const {data,error}=await this.db.getClient().rpc(name,args);if(error){if(error.code==='42501')throw new ForbiddenException('Consulta exclusiva ao Owner ativo.');if(['22023','40001'].includes(error.code))throw new BadRequestException('Confira os filtros, a justificativa e os bloqueios de reenvio.');throw new ServiceUnavailableException('Operação não confirmada; reconfira o histórico antes de repetir.');}if(data==null&&name!=='claim_platform_team_notification')throw new ServiceUnavailableException('Resultado não confirmado; reconfira o histórico.');return data;}
 async list(actor:string,q:Record<string,string>,id?:string){
  this.gate();const page=Number(q.page??0);if(!Number.isInteger(page)||page<0||page>10000)throw new BadRequestException('Página inválida.');
  for(const k of ['from','to'])if(q[k]&&!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{3})?Z$/.test(q[k]))throw new BadRequestException('Período inválido.');
  if(q.state&&!['PENDING','SENDING','ACCEPTED','DELIVERED','DELAYED','FAILED','BOUNCED','COMPLAINED','UNKNOWN'].includes(q.state))throw new BadRequestException('Estado inválido.');
  if(q.profile&&!['OWNER','ADMINISTRATOR','FINANCE','SUPPORT'].includes(q.profile))throw new BadRequestException('Perfil inválido.');
  if(q.user&&!/^[0-9a-f-]{36}$/i.test(q.user))throw new BadRequestException('Identidade inválida.');
  const result=await this.rpc('read_platform_team_notifications',{p_actor:actor,p_id:id??null,p_offset:page*25,p_state:q.state||null,p_profile:q.profile||null,p_from:q.from||null,p_to:q.to||null,p_user:q.user||null});
  if(id&&result?.notification){
   const {data,error}=await this.db.createAuthClient().auth.admin.getUserById(result.notification.user_id);
   result.authentication=!error&&data?.user?{invitedAt:data.user.invited_at??null,lastSignInAt:data.user.last_sign_in_at??null,emailConfirmedAt:data.user.email_confirmed_at??null}:{unavailable:true};
  }
  return result;
 }
 async prepare(actor:string,user:string,reason:unknown){this.gate();if(typeof reason!=='string'||reason.trim().length<20||reason.length>1000)throw new BadRequestException('Justificativa obrigatória, de 20 a 1000 caracteres.');return this.rpc('prepare_platform_team_notification',{p_actor:actor,p_user:user,p_reason:reason.trim()});}
 async retry(actor:string,id:string,reason:unknown){this.gate();if(typeof reason!=='string'||reason.trim().length<20||reason.length>1000)throw new BadRequestException('Justificativa obrigatória, de 20 a 1000 caracteres.');return this.rpc('retry_platform_team_notification',{p_actor:actor,p_id:id,p_reason:reason.trim()});}
 async metrics(actor:string,month:string){this.gate();if(!/^(20|21)\d{2}-(0[1-9]|1[0-2])$/.test(month??''))throw new BadRequestException('Competência inválida.');return this.rpc('platform_team_notification_metrics',{p_actor:actor,p_month:month});}
 async webhook(raw:Buffer,headers:Record<string,unknown>){
  if(!enabled('PLATFORM_TEAM_NOTIFICATION_WEBHOOK_ENABLED'))throw new ServiceUnavailableException('Webhook desligado.');
  let event:ReturnType<typeof verifyTeamWebhook>;try{event=verifyTeamWebhook(raw,headers,process.env.PLATFORM_TEAM_RESEND_WEBHOOK_SECRET??'');}catch{throw new BadRequestException('Evento não autenticado.');}
  if('ignored' in event)return {ignored:true};
  const result=await this.rpc('record_platform_team_notification_delivery',{p_key:event.id,p_provider:event.provider,p_state:event.state,p_at:event.at,p_notification:event.correlation?.notification??null,p_recipient:event.correlation?.recipient??null,p_from:event.correlation?.from??null,p_subject:event.correlation?.subject??null});
  if(result?.retry)throw new ServiceUnavailableException('Aguardando vínculo do recibo; reentregar evento.');return result;
 }
 private async provider(path:string,method='GET',body?:unknown,key?:string){
  const api=process.env.RESEND_API_KEY;if(!api)throw Error('CONFIGURATION');
  return fetch('https://api.resend.com'+path,{method,headers:{Authorization:'Bearer '+api,'Content-Type':'application/json',...(key?{'Idempotency-Key':key}:{})},body:body?JSON.stringify(body):undefined,redirect:'error',signal:AbortSignal.timeout(15000)});
 }
 async tick(){
  if(this.running||!enabled('PLATFORM_TEAM_NOTIFICATIONS_ENABLED')||!enabled('PLATFORM_TEAM_NOTIFICATION_CALLS_ENABLED'))return;
  this.running=true;let row:any,lease:string|undefined,posted=false,payload:any=null,version:string|null=null,hash:string|null=null;
  try{
   lease=randomUUID();row=await this.rpc('claim_platform_team_notification',{p_lease:lease});if(!row)return;
   const variables=teamVariables(row);const snapshot=templateSnapshot(TEAM_TEMPLATE_SNAPSHOT,process.env.PLATFORM_TEAM_RESEND_TEMPLATE_VERSION??'',process.env.PLATFORM_TEAM_RESEND_TEMPLATE_HASH??'',variables);
   // Render the approved published version locally: later dashboard edits cannot race this send.
   payload={from:TEAM_FROM,to:[row.recipient],subject:TEAM_SUBJECT,html:snapshot.html,tags:[{name:'flow',value:'platform-team'},{name:'notification',value:row.id}]};version=snapshot.version;hash=snapshot.hash;
   const staged=await this.rpc('stage_platform_team_notification',{p_id:row.id,p_lease:lease,p_payload:payload,p_version:version,p_hash:hash});
   if(staged?.recorded!==true)throw Error('STAGE_NOT_CONFIRMED');
   if(!enabled('PLATFORM_TEAM_NOTIFICATION_CALLS_ENABLED'))throw Error('CALLS_DISABLED');
   posted=true;const sent=await this.provider('/emails','POST',payload,'platform-team/'+row.id);
   if(!sent.ok){
    // No automatic retry, including rate-limit/provider errors. Owner must inspect evidence.
    const definitive=[400,401,403,422].includes(sent.status);
    await this.finish(row.id,lease,definitive?'FAILED':'UNKNOWN',null,payload,version,hash,definitive?'Provedor rejeitou a requisição; sem reenvio automático.':'Resposta do provedor não confirmou envio; reconferência obrigatória.');return;
   }
   const result:any=await sent.json();if(typeof result?.id!=='string'||!/^[0-9a-f-]{36}$/.test(result.id))throw Error('RECEIPT_INVALID');
   await this.finish(row.id,lease,'ACCEPTED',result.id,payload,version,hash,'Aceito pelo Resend; aguardando evidência de entrega.');
  }catch{
   if(row&&lease)await this.finish(row.id,lease,posted?'UNKNOWN':'FAILED',null,payload,version,hash,posted?'Resultado não confirmado; não reenviar.':'Pré-validação não concluída; nenhuma chamada de envio confirmada.').catch(()=>undefined);
  }finally{this.running=false;}
 }
 private finish(id:string,lease:string,state:string,provider:string|null,payload:any,version:string|null,hash:string|null,reason:string){return this.rpc('finish_platform_team_notification',{p_id:id,p_lease:lease,p_state:state,p_provider:provider,p_payload:payload,p_version:version,p_hash:hash,p_reason:reason});}
}
