import {BadRequestException,ConflictException,ForbiddenException,Injectable,ServiceUnavailableException} from '@nestjs/common';
import {ConfigService} from '@nestjs/config';
import {SupabaseService} from '../../services/supabase.service';
@Injectable()
export class TeamPasswordService{
 constructor(private readonly db:SupabaseService,private readonly config:ConfigService){}
 private async bounded<T>(work:Promise<T>):Promise<T>{let timer:ReturnType<typeof setTimeout>|undefined;try{return await Promise.race([work,new Promise<T>((_,reject)=>{timer=setTimeout(()=>reject(new Error('Provider timeout')),20000)})]);}finally{if(timer)clearTimeout(timer);}}
 private enabled(){if(this.config.get<string>('PLATFORM_TEAM_PASSWORD_ENABLED')!=='true')throw new ServiceUnavailableException('Acesso e senha ainda não habilitado.');}
 private check(error:any){if(!error)return;if(error.code==='42501')throw new ForbiddenException('Acesso exclusivo ao Owner ativo.');if(error.code==='40001')throw new ConflictException('Existe uma solicitação pendente ou recente. Confira o histórico antes de repetir.');if(error.code==='22023')throw new BadRequestException('Confira identidade, situação e justificativa.');throw new ServiceUnavailableException('Resultado não confirmado. Confira o histórico antes de repetir.');}
 async read(actor:string,user:string,page=0){this.enabled();if(!Number.isInteger(page)||page<0||page>1000)throw new BadRequestException('Página inválida.');const r=await this.db.getClient().rpc('read_platform_team_password',{p_actor:actor,p_user:user,p_offset:page*25});this.check(r.error);if(!r.data)throw new ServiceUnavailableException('Consulta indisponível.');return r.data;}
 async send(actor:string,user:string,key:string,reason:string){
  this.enabled();if(this.config.get<string>('PLATFORM_TEAM_PASSWORD_CALLS_ENABLED')!=='true')throw new ServiceUnavailableException('Envio de link de senha desligado.');
  const declared=this.config.get<string>('FRONTEND_URL')||this.config.get<string>('CORS_ORIGIN')||'https://app.expertenergy.com.br';
  let origin:string;
  try{const target=new URL(declared);if(target.origin!=='https://app.expertenergy.com.br'||target.pathname!=='/'||target.search||target.hash||target.username||target.password)throw new Error('Unsafe destination');origin=target.origin;}catch{throw new ServiceUnavailableException('Destino de autenticação não conferido.');}
  const client=this.db.getClient();const r=await client.rpc('reserve_platform_team_password',{p_actor:actor,p_user:user,p_key:key,p_reason:reason.trim()});this.check(r.error);
  if(!r.data?.id)throw new ServiceUnavailableException('Reserva não confirmada; confira o histórico.');
  if(!r.data.created)return {id:r.data.id,state:r.data.state,duplicate:true};
  let state:'ACCEPTED'|'FAILED'|'UNKNOWN'='UNKNOWN';
  try{
   // Recheck Owner, current assignment and Auth state immediately before the provider call.
   const current=await this.read(actor,user);const auth=this.db.createAuthClient();const lookup=await this.bounded(auth.auth.admin.getUserById(user));
   if(lookup.error||!lookup.data?.user)throw new Error('Uncertain identity');
   const identity=lookup.data.user;
   const purpose=identity.email_confirmed_at?'RECOVERY':identity.invited_at?'INVITE':null;
   if(!current.active||current.email!==r.data.email||identity.email?.trim().toLowerCase()!==r.data.email||purpose!==r.data.purpose||current.purpose!==purpose){state='FAILED';}
   else{
    const result=await this.bounded<any>(purpose==='INVITE'?auth.auth.admin.inviteUserByEmail(r.data.email,{redirectTo:origin+'/auth/accept-invite'}):auth.auth.resetPasswordForEmail(r.data.email,{redirectTo:origin+'/auth/reset-password'}));
    if(!result.error){
     state=purpose==='INVITE'&&((result as any).data?.user?.id!==user)?'UNKNOWN':'ACCEPTED';
    }else if([400,422,429].includes(Number(result.error.status)))state='FAILED';
   }
  }catch{state='UNKNOWN';}
  const done=await client.rpc('finish_platform_team_password',{p_actor:actor,p_id:r.data.id,p_state:state});this.check(done.error);
  if(!done.data)throw new ServiceUnavailableException('Resultado não confirmado. Confira o histórico antes de repetir.');
  return {id:r.data.id,state:done.data.state,message:done.data.state==='ACCEPTED'?'Solicitação aceita pelo Auth. Oriente o usuário a verificar o e-mail mais recente e o spam.':'Confira o histórico. Nenhuma nova tentativa automática será feita.'};
 }
}
