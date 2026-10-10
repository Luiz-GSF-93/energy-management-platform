import {BadRequestException,ConflictException,ForbiddenException,Injectable,ServiceUnavailableException} from '@nestjs/common';
import {SupabaseService} from '../../services/supabase.service';
import {InsertTeamDto,UpdateTeamDto} from './platform-team.dto';
type Actor={userId:string;ip?:string;agent?:string};
@Injectable()
export class PlatformTeamService{
 constructor(private readonly db:SupabaseService){}
 private check(error:any){
  if(!error)return;
  if(error.code==='42501')throw new ForbiddenException('Somente Owner ativo pode gerenciar a equipe.');
  if(['P4001','P4002','P4003','23505'].includes(error.code))throw new ConflictException('Revise o limite de dois Owners, o último Owner ativo e a versão do cadastro.');
  if(['22023','23514','P4004'].includes(error.code))throw new BadRequestException('Confira identidade, nome e perfil. Não é possível misturar acesso da equipe com vínculos de organização ou Portal.');
  throw new ServiceUnavailableException('Operação não confirmada. Atualize e confira o cadastro antes de repetir.');
 }
 async list(actor:Actor,page=0){
  if(!Number.isInteger(page)||page<0||page>10000)throw new BadRequestException('Página inválida.');
  const {data,error}=await this.db.getClient().rpc('read_platform_team',{p_actor:actor.userId,p_offset:page*25});
  this.check(error);if(!data)throw new ServiceUnavailableException('Cadastro indisponível.');return data;
 }
 async save(user:string,dto:UpdateTeamDto,actor:Actor){return this.command(user,dto,actor,false);}
 private async command(user:string,dto:UpdateTeamDto|InsertTeamDto,actor:Actor,created:boolean){
  const {data,error}=await this.db.getClient().rpc('save_platform_team_member',{
   p_actor:actor.userId,p_user:user,p_profile:dto.profile,
   p_first:dto.firstName.trim(),p_last:dto.lastName.trim(),p_active:'active' in dto?dto.active:true,
   p_revision:'revision' in dto?dto.revision:null,p_email:'email' in dto?dto.email.trim().toLowerCase():null,
   p_new_identity:created,p_reason:dto.reason.trim(),p_ip:actor.ip??null,p_agent:actor.agent??null,
  });
  this.check(error);if(data?.userId!==user)throw new ServiceUnavailableException('Acesso não confirmado.');return data;
 }
 async insert(dto:InsertTeamDto,actor:Actor){
  const email=dto.email.trim().toLowerCase(),client=this.db.getClient();
  // Authorization is rechecked in the transaction after the provider call.
  const permission=await client.rpc('prepare_platform_team_invite',{p_actor:actor.userId,p_profile:dto.profile});
  this.check(permission.error);if(permission.data?.authorized!==true)throw new ForbiddenException('Owner ativo obrigatório.');
  const lookup=await client.from('user_profiles').select('user_id,email').eq('email',email);
  if(lookup.error)throw new ServiceUnavailableException('Cadastro de identidade indisponível.');
  if(lookup.data?.length>1)throw new ConflictException('Identidade ambígua.');
  const auth=this.db.createAuthClient();let user:string;let created=false;
  if(lookup.data?.length===1){
   user=lookup.data[0].user_id;
   const {data,error}=await auth.auth.admin.getUserById(user);
   if(error||data?.user?.email?.trim().toLowerCase()!==email)throw new ConflictException('Identidade não confirmada.');
  }else{
   // Do not overwrite an existing auth identity lacking a valid profile.
   let complete=false;
   for(let page=1;page<=20;page++){
    const {data,error}=await auth.auth.admin.listUsers({page,perPage:100});
    if(error||!Array.isArray(data?.users))throw new ServiceUnavailableException('Consulta de identidade indisponível.');
    if(data.users.some((u:any)=>u.email?.trim().toLowerCase()===email))throw new ConflictException('Identidade existente sem cadastro válido; requer recuperação separada.');
    if((typeof data.lastPage==='number'&&page>=data.lastPage)||(data.lastPage==null&&data.users.length<100)){complete=true;break;}
   }
   if(!complete)throw new ServiceUnavailableException('Não foi possível confirmar a identidade.');
   const origin=process.env.FRONTEND_URL||process.env.CORS_ORIGIN;
   if(!origin||new URL(origin).protocol!=='https:')throw new ServiceUnavailableException('Destino seguro do convite não configurado.');
   const {data,error}=await auth.auth.admin.inviteUserByEmail(email,{data:{name:dto.firstName.trim()+' '+dto.lastName.trim()},redirectTo:new URL('/auth/accept-invite',origin).toString()});
   if(error||!data?.user?.id||data.user.email?.trim().toLowerCase()!==email)throw new ServiceUnavailableException('Convite não confirmado; nenhum perfil concedido.');
   user=data.user.id;created=true;
  }
  // A failed grant leaves no privileged role. Never delete an identity on uncertainty.
  return this.command(user!,dto,actor,created);
 }
}
