import {BadRequestException,ForbiddenException,ConflictException,Injectable,InternalServerErrorException,NotFoundException} from '@nestjs/common';
import {SupabaseService} from '../../services/supabase.service';
import {ApplyPlanDto,SavePlanDto} from './plans.dto';
type Actor={userId:string;ip?:string;agent?:string};
export const PLAN_VIEW='e23a5c98-8b68-4ed2-aef8-70a7166407e4';
export const PLAN_MANAGE='af285642-16b0-405a-982c-58de1a10f987';
@Injectable()
export class PlansService {
 constructor(private readonly supabase:SupabaseService){}
 async list(activeOnly=false){
  let query=this.supabase.getClient().from('plan_catalog').select('*').order('name');
  if(activeOnly)query=query.eq('active',true);
  const {data,error}=await query;
  if(error)throw new InternalServerErrorException('Não foi possível consultar os planos.');
  return data??[];
 }
 private check(error:any){
  if(!error)return;
  if(error.code==='42501')throw new ForbiddenException('Somente o administrador da plataforma pode alterar planos e licenças.');
  if(error.code==='P3393')throw new ConflictException('O plano selecionado é inferior ao consumo atual. Revise usuários, unidades e documentos.');
  if(error.code==='P3392')throw new BadRequestException('Selecione um plano do catálogo.');
  if(error.code==='P3150')throw new NotFoundException('Plano ativo ou organização não encontrado.');
  if(error.code==='P3151')throw new ConflictException('O plano foi alterado. Atualize a lista e revise antes de salvar.');
  if(error.code==='P3152')throw new ConflictException('O limite de usuários é inferior à quantidade de vínculos ativos.');
  if(error.code==='23505')throw new ConflictException('Já existe um plano com esse nome.');
  if(error.code==='23P01')throw new ConflictException('Já existe licença ativa para essa vigência.');
  if(error.code==='22023'||error.code==='23514')throw new BadRequestException('Revise os limites e as datas informados.');
  throw new InternalServerErrorException('Não foi possível salvar o plano ou a licença.');
 }
 async save(id:string|null,dto:SavePlanDto,actor:Actor){
  if(id&&!dto.version)throw new BadRequestException('Informe a versão do plano.');
  const {version,...definition}=dto;
  const {data,error}=await this.supabase.getClient().rpc('save_catalog_plan',{target_id:id,expected_version:version??null,definition:{...definition,name:dto.name.trim()},actor_id:actor.userId,audit_ip:actor.ip??null,audit_agent:actor.agent??null});
  this.check(error);if(!data?.id)throw new InternalServerErrorException('Resultado do plano não confirmado.');return data;
 }
 async apply(org:string,dto:ApplyPlanDto,actor:Actor){
  if(!org)throw new BadRequestException('Selecione uma organização.');
  if(dto.endDate&&dto.endDate<dto.startDate)throw new BadRequestException('O término não pode ser anterior ao início.');
  if(dto.licenseId&&!dto.revision)throw new BadRequestException('Atualize a licença antes de salvar.');
  const {data,error}=await this.supabase.getClient().rpc('save_plan_license',{target_organization:org,target_license:dto.licenseId??null,expected_revision:dto.revision??null,target_plan:dto.planId,expected_version:dto.version,starts:dto.startDate,ends:dto.endDate??null,renews:dto.renewalDate,next_status:dto.status??'ACTIVE',selected_modules:dto.modules??null,actor_id:actor.userId,audit_ip:actor.ip??null,audit_agent:actor.agent??null});
  this.check(error);if(!data?.id||data.organization_id!==org||(dto.licenseId&&data.id!==dto.licenseId))throw new InternalServerErrorException('Resultado da licença não confirmado.');return data;
 }
 async usage(org:string){
  const client=this.supabase.getClient();
  const [used,licenses,requests]=await Promise.all([client.rpc('organization_resource_usage',{org}),client.from('licenses').select('*').eq('organization_id',org).eq('active',true),client.from('license_upgrade_requests').select('*').eq('organization_id',org).eq('status','pending')]);
  if(used.error||licenses.error||requests.error)throw new InternalServerErrorException('Não foi possível consultar o consumo. Tente atualizar.');
  const today=new Date().toISOString().slice(0,10);
  const effective=(licenses.data??[]).filter((l:any)=>l.status?.toLowerCase()==='active'&&l.start_date&&l.start_date<=today&&(!l.end_date||l.end_date>=today));
  if(effective.length>1)throw new ConflictException('Há mais de uma licença vigente. Solicite revisão administrativa.');
  return {used:used.data,license:effective[0]??null,requests:requests.data??[],updatedAt:new Date().toISOString()};
 }
 async upgrades(org?:string){
  let q=this.supabase.getClient().from('license_upgrade_requests').select('*, organizations(name)').eq('status','pending').order('created_at');
  if(org)q=q.eq('organization_id',org);
  const {data,error}=await q;if(error)throw new InternalServerErrorException('Não foi possível consultar as solicitações.');return data??[];
 }
 async requestUpgrade(org:string,note:string,actor:string){
  const {data,error}=await this.supabase.getClient().rpc('request_license_upgrade',{org,actor,message:note.trim()});
  if(error?.code==='23505')throw new ConflictException('Já existe uma solicitação pendente para esta organização.');
  this.check(error);return data;
 }
 async resolveUpgrade(id:string,actor:string){const {data,error}=await this.supabase.getClient().rpc('resolve_license_upgrade',{target:id,actor});this.check(error);return data;}
}
