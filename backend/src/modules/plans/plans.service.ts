import {BadRequestException,ConflictException,Injectable,InternalServerErrorException,NotFoundException} from '@nestjs/common';
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
  const {data,error}=await this.supabase.getClient().rpc('create_license_from_plan',{target_organization:org,target_plan:dto.planId,expected_version:dto.version,starts:dto.startDate,ends:dto.endDate??null,renews:dto.renewalDate,actor_id:actor.userId,audit_ip:actor.ip??null,audit_agent:actor.agent??null});
  this.check(error);if(!data?.id||data.organization_id!==org)throw new InternalServerErrorException('Resultado da licença não confirmado.');return data;
 }
}
