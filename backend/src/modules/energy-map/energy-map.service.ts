import {ConflictException,ForbiddenException,Injectable,InternalServerErrorException,BadRequestException,NotFoundException} from '@nestjs/common';
import {ConfigService} from '@nestjs/config';
import {SupabaseService} from '../../services/supabase.service';
import {LicensesService} from '../licenses/services/licenses.service';
import {TenantContext} from '../../common/interfaces/tenant-context.interface';
import {MAP_VIEW,MAP_CUSTOMERS,MAP_MANAGE,mapId,mapQuery,locationInput} from './energy-map.validation';

@Injectable()
export class EnergyMapService {
 constructor(private db:SupabaseService,private licenses:LicensesService,private config:ConfigService){}
 private fail(e:any){
  if(!e)return;
  if(e.code==='42501')throw new ForbiddenException('Mapa exige acesso autorizado ao cadastro e licença ativa.');
  if(e.code==='P3161'||e.code==='23505')throw new ConflictException('A localização ou o endereço mudou. Atualize antes de salvar.');
  if(e.code==='P3162')throw new NotFoundException('Unidade indisponível nesta organização.');
  if(['22023','23514','22P02'].includes(e.code))throw new BadRequestException('Revise os dados de localização.');
  throw new InternalServerErrorException('Não foi possível consultar o mapa.');
 }
 private enabled(org:string){return (this.config.get<string>('ENERGY_MAP_ORGANIZATIONS')||'').split(',').map(v=>v.trim()).includes(org);}
 async access(t:TenantContext){
  if(!t?.organizationId||!t.userId||!t.permissions?.includes(MAP_VIEW)||!t.permissions.includes(MAP_CUSTOMERS)||(!['admin_org','gestor','operacional'].includes(t.role)&&t.accessMode!=='platform_operation'))throw new ForbiddenException('Mapa disponível somente ao backoffice autorizado.');
  if(!await this.licenses.resolveEffectiveLicense(t.organizationId))throw new ForbiddenException('O mapa exige licença ativa.');
  const r=await this.db.getClient().rpc('assert_energy_map_actor',{p_org:t.organizationId,p_actor:t.userId,p_write:false});this.fail(r.error);
  return {enabled:this.enabled(t.organizationId),canManage:t.permissions.includes(MAP_MANAGE),organizationId:t.organizationId};
 }
 private async allowed(t:TenantContext,write=false){const access=await this.access(t);if(!access.enabled||write&&!access.canManage)throw new ForbiddenException('Mapa não habilitado ou ação sem permissão nesta organização.');return access;}
 async units(input:unknown,t:TenantContext){
  const access=await this.allowed(t),q=mapQuery(input);
  const r=await this.db.getClient().rpc('read_energy_map_units',{p_org:t.organizationId,p_actor:t.userId,p_query:q});this.fail(r.error);
  if(!r.data||!Array.isArray(r.data.rows)||!Number.isSafeInteger(r.data.total)||r.data.rows.length>q.limit||r.data.rows.some((v:any)=>v.organizationId!==t.organizationId))throw new InternalServerErrorException('Resposta do mapa fora do escopo.');
  return {...r.data,...access};
 }
 async history(id:string,t:TenantContext){
  await this.allowed(t);mapId(id);
  const u=await this.db.getClient().from('consumer_units').select('id').eq('organization_id',t.organizationId).eq('id',id).maybeSingle();this.fail(u.error);if(!u.data)throw new NotFoundException('Unidade indisponível nesta organização.');
  const r=await this.db.getClient().from('consumer_unit_location_history').select('revision,reason,actor_id,recorded_at,location').eq('organization_id',t.organizationId).eq('consumer_unit_id',id).order('revision',{ascending:false}).limit(50);this.fail(r.error);return r.data;
 }
 async save(id:string,input:unknown,t:TenantContext){
  await this.allowed(t,true);mapId(id);const d=locationInput(input);
  const r=await this.db.getClient().rpc('save_energy_map_location',{p_org:t.organizationId,p_actor:t.userId,p_unit:id,p_data:d});this.fail(r.error);return r.data;
 }
}
