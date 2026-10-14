import {BadRequestException,ConflictException,ForbiddenException,Injectable,ServiceUnavailableException} from '@nestjs/common';
import {ConfigService} from '@nestjs/config';
import {SupabaseService} from '../../services/supabase.service';
@Injectable()
export class TeamPasswordService{
 constructor(private readonly db:SupabaseService,private readonly config:ConfigService){}
 private async bounded<T>(work:PromiseLike<T>,ms=20000):Promise<T>{let timer:ReturnType<typeof setTimeout>|undefined;try{return await Promise.race([Promise.resolve(work),new Promise<T>((_,reject)=>{timer=setTimeout(()=>reject(new Error('Request timeout')),ms)})]);}finally{if(timer)clearTimeout(timer);}}
 private async rpc(name:string,args:Record<string,unknown>){
  const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),10000);
  try{return await this.bounded<any>(this.db.getClient().rpc(name,args).retry(false).abortSignal(controller.signal),10000);}finally{clearTimeout(timer);}
 }
 private enabled(){if(this.config.get<string>('PLATFORM_TEAM_PASSWORD_ENABLED')!=='true')throw new ServiceUnavailableException('Acesso e senha ainda não habilitado.');}
 private check(error:any){if(!error)return;if(error.code==='42501')throw new ForbiddenException('Acesso exclusivo ao Owner ativo.');if(['PT409','40001'].includes(error.code))throw new ConflictException('Existe uma solicitação pendente ou recente. Aguarde dez minutos entre pedidos e confira o histórico.');if(error.code==='PT408')throw new ConflictException('Prazo da solicitação encerrado. Confira o histórico antes de repetir.');if(error.code==='22023')throw new BadRequestException('Confira identidade, situação e justificativa.');throw new ServiceUnavailableException('Resultado não confirmado. Confira o histórico antes de repetir.');}
 async read(actor:string,user:string,page=0){this.enabled();if(!Number.isInteger(page)||page<0||page>1000)throw new BadRequestException('Página inválida.');let r:any;try{r=await this.rpc('read_platform_team_password',{p_actor:actor,p_user:user,p_offset:page*25});}catch{throw new ServiceUnavailableException('Consulta não concluída no prazo. Reconfira o histórico.');}this.check(r.error);if(!r.data)throw new ServiceUnavailableException('Consulta indisponível.');return r.data;}
 async send(actor:string,user:string,key:string,reason:string){
  this.enabled();if(this.config.get<string>('PLATFORM_TEAM_PASSWORD_CALLS_ENABLED')!=='true')throw new ServiceUnavailableException('Envio de link de senha desligado.');
  const declared=this.config.get<string>('FRONTEND_URL')||this.config.get<string>('CORS_ORIGIN')||'https://app.expertenergy.com.br';
  let origin:string;
  try{const target=new URL(declared);if(target.origin!=='https://app.expertenergy.com.br'||target.pathname!=='/'||target.search||target.hash||target.username||target.password)throw new Error('Unsafe destination');origin=target.origin;}catch{throw new ServiceUnavailableException('Destino de autenticação não conferido.');}
  const deadline=Date.now()+45000;
  let r:any;try{r=await this.rpc('reserve_platform_team_password_expiring',{p_actor:actor,p_user:user,p_key:key,p_reason:reason.trim(),p_deadline:new Date(deadline).toISOString()});}catch{throw new ServiceUnavailableException('Reserva não confirmada no prazo. Confira o histórico antes de repetir.');}this.check(r.error);
  if(!r.data?.id)throw new ServiceUnavailableException('Reserva não confirmada; confira o histórico.');
  if(!r.data.created)return {id:r.data.id,state:r.data.state,duplicate:true};
  let state:'ACCEPTED'|'FAILED'|'UNKNOWN'|'NOT_SENT'='NOT_SENT';
  try{
   // Recheck Owner, current assignment and Auth state immediately before the provider call.
   const current=await this.read(actor,user);const auth=this.db.createAuthClient();const lookup=await this.bounded(auth.auth.admin.getUserById(user),10000);
   if(lookup.error||!lookup.data?.user)throw new Error('Uncertain identity');
   const identity=lookup.data.user;
   const purpose=identity.email_confirmed_at?'RECOVERY':identity.invited_at?'INVITE':null;
   if(!current.active||current.email!==r.data.email||identity.email?.trim().toLowerCase()!==r.data.email||purpose!==r.data.purpose||current.purpose!==purpose){state='NOT_SENT';}
   else{
    // Ambiguous checkpoint outcomes remain blocked. Never resume a claimed call.
    state='UNKNOWN';
    const start=await this.rpc('start_platform_team_password',{p_actor:actor,p_id:r.data.id});this.check(start.error);
    if(!start.data?.started)throw new Error('Call already claimed or expired');
    if(Date.now()>=deadline)throw new Error('Expired before provider call');
    const result=await this.bounded<any>(purpose==='INVITE'?auth.auth.admin.inviteUserByEmail(r.data.email,{redirectTo:origin+'/auth/accept-invite'}):auth.auth.resetPasswordForEmail(r.data.email,{redirectTo:origin+'/auth/reset-password'}));
    if(!result.error){
     state=purpose==='INVITE'&&((result as any).data?.user?.id!==user)?'UNKNOWN':'ACCEPTED';
    }else if([400,422,429].includes(Number(result.error.status)))state='FAILED';
   }
  }catch{/* Preserve uncertainty after the durable provider checkpoint. */}
  let done:any;try{done=await this.rpc('finish_platform_team_password',{p_actor:actor,p_id:r.data.id,p_state:state});}catch{throw new ServiceUnavailableException('Conclusão não confirmada no prazo. Reconfira o histórico antes de repetir.');}this.check(done.error);
  if(!done.data)throw new ServiceUnavailableException('Resultado não confirmado. Confira o histórico antes de repetir.');
  return {id:r.data.id,state:done.data.state,message:done.data.state==='ACCEPTED'?'Solicitação aceita pelo Auth. Oriente o usuário a verificar o e-mail mais recente e o spam.':'Confira o histórico. Nenhuma nova tentativa automática será feita.'};
 }
}
