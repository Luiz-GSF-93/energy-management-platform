import {auditAuthorNames} from '../contracts/services/audit-author-names';
import {Injectable,ForbiddenException,ConflictException,BadRequestException,InternalServerErrorException,NotFoundException} from '@nestjs/common';
import {ConfigService} from '@nestjs/config';
import {SupabaseService} from '../../services/supabase.service';
import {TenantContext} from '../../common/interfaces/tenant-context.interface';
import {PERMISSIONS as P} from '../../common/constants/permissions';
import {PortalLicenseDto,PortalPolicyDto,ClientAdditionDto} from './portal-license.dto';
import {PortalModule} from './portal-route-module';
@Injectable()
export class PortalLicenseService {
 constructor(private db:SupabaseService,private config:ConfigService){}
 enabled(){return this.config.get('CLIENT_PORTAL_LICENSES_ENABLED')==='true';}
 private errors(error:{code?:string}|null){
  if(!error)return;
  if(error.code==='42501')throw new ForbiddenException('Licença ou vínculo exclusivo do Portal indisponível.');
  if(error.code==='P3410')throw new ConflictException('Regularize o limite compartilhado de usuários e as licenças do Portal antes de ativar.');
  if(error.code==='P3411')throw new ConflictException('Limite contratado atingido. Solicite upgrade ou acréscimo.');
  if(error.code==='P3412')throw new ConflictException('O limite proposto é inferior ao uso atual.');
  if(error.code==='P3413')throw new ConflictException('A versão mudou. Atualize e confira antes de salvar.');
  if(['22023','23514','23502','22P02','22003','22007','22008'].includes(error.code??''))throw new BadRequestException('Confira datas, limites e módulos da licença.');
  throw new InternalServerErrorException('Não foi possível confirmar a licença do Portal.');
 }
 private backoffice(t:TenantContext,write=false){
  if(!t?.organizationId||!t.userId||(t.scope as string)==='global'||(!['admin_org','gestor'].includes(t.role)&&t.accessMode!=='platform_operation')||!t.permissions?.includes(write?P.ORGANIZATION_LICENSES_UPDATE:P.ORGANIZATION_LICENSES_VIEW)||(write&&t.accessMode!=='platform_operation'))throw new ForbiddenException('Gestão de licença restrita à organização e ao administrador da plataforma.');
 }
 private requireEnabled(){if(!this.enabled())throw new NotFoundException('Licenças do Portal em implantação; ativação ainda desligada.');}
 async list(t:TenantContext){
  this.backoffice(t);if(!this.enabled())return {available:false,enabled:false,licenses:[],additions:[],history:[]};
  const client=this.db.getClient();
  const queries=await Promise.all([client.rpc('client_capacity',{org:t.organizationId}),client.from('client_portal_policies').select('enabled,revision').eq('organization_id',t.organizationId).maybeSingle(),client.from('client_portal_licenses').select('*,customers!inner(company_name,organization_id)').eq('organization_id',t.organizationId).eq('customers.organization_id',t.organizationId).order('created_at').limit(201),client.from('license_client_additions').select('*').eq('organization_id',t.organizationId).order('created_at').limit(201),client.from('client_portal_license_events').select('*').eq('organization_id',t.organizationId).order('created_at',{ascending:false}).limit(50)]);
  queries.forEach(r=>this.errors(r.error));const [capacity,policy,licenses,additions,history]=queries;
  if(!capacity.data||!Array.isArray(licenses.data)||licenses.data.length>200||!Array.isArray(additions.data)||additions.data.length>200||!Array.isArray(history.data))throw new BadRequestException('Consulta de licenças extensa ou indisponível; nenhum conjunto parcial foi emitido.');
  for(const result of [licenses,additions,history])if(result.data.some((r:{organization_id:string})=>r.organization_id!==t.organizationId))throw new InternalServerErrorException('Licença fora do escopo da organização.');
  if(licenses.data.some((r:{customers?:{organization_id?:string}})=>r.customers?.organization_id!==t.organizationId))throw new InternalServerErrorException('Cliente fora do escopo da licença.');
  return {available:true,enabled:policy.data?.enabled??false,revision:policy.data?.revision??0,capacity:capacity.data,licenses:licenses.data,additions:additions.data,history:await auditAuthorNames(this.db.getClient(),t.organizationId,history.data)};
 }
 async save(t:TenantContext,input:PortalLicenseDto){this.backoffice(t,true);this.requireEnabled();const {customerId,...definition}=input;const r=await this.db.getClient().rpc('save_client_portal_license',{p_org:t.organizationId,p_customer:customerId,p_actor:t.userId,p_data:definition});this.errors(r.error);if(!r.data?.id||r.data.organization_id!==t.organizationId||r.data.customer_id!==customerId)throw new InternalServerErrorException('Licença não confirmada no cliente autorizado.');return r.data;}
 async policy(t:TenantContext,input:PortalPolicyDto){this.backoffice(t,true);this.requireEnabled();const r=await this.db.getClient().rpc('set_client_portal_policy',{p_org:t.organizationId,p_actor:t.userId,p_enabled:input.enabled,p_revision:input.revision,p_reason:input.reason.trim()});this.errors(r.error);if(r.data?.organization_id!==t.organizationId)throw new InternalServerErrorException('Ativação não confirmada.');return r.data;}
 async addition(t:TenantContext,_input:ClientAdditionDto){this.backoffice(t,true);this.requireEnabled();throw new NotFoundException('Cotas separadas de clientes foram substituídas pelas vagas de usuários do plano.');}
 async client(t:TenantContext,module:PortalModule|null=null){
  if(!t?.organizationId||!t.userId||(t.scope as string)==='global'||t.role!=='consulta'||t.accessMode||!t.roleId)throw new ForbiddenException('Use uma conta de cliente vinculada exclusivamente à empresa.');
  if(!this.enabled())return {enabled:false};
  const r=await this.db.getClient().rpc('client_portal_entitlement',{p_org:t.organizationId,p_actor:t.userId,p_role:t.roleId,p_module:module});this.errors(r.error);
  if(typeof r.data?.enabled!=='boolean')throw new InternalServerErrorException('Estado da licença não confirmado.');
  if(r.data.enabled&&(r.data.organizationId!==t.organizationId||!r.data.customerId||!Array.isArray(r.data.modules)||(module&&!r.data.modules.includes(module))))throw new ForbiddenException('Módulo não contratado no Portal.');
  return r.data.enabled?r.data:{enabled:false};
 }
}
