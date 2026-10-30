import {UserRequestsService} from '../admin/users/services/user-requests.service';
import {Body,Controller,ForbiddenException,Get,Header,Post,ServiceUnavailableException,BadRequestException} from '@nestjs/common';
import {Tenant} from '../../common/decorators/tenant.decorator';
import {TenantContext} from '../../common/interfaces/tenant-context.interface';
import {SupabaseService} from '../../services/supabase.service';
import {multiCustomerEnabled,assertCurrentPortalScope} from '../../common/services/portal-customer-context';
@Controller('portal')
export class PortalCustomerAccessController {
 constructor(private db:SupabaseService,private requests:UserRequestsService){}
 @Get('customers') @Header('Cache-Control','private, no-store') async customers(@Tenant() t:TenantContext){
  if(t.accessMode||t.role!=='consulta')throw new ForbiddenException('Use uma conta externa do Portal.');
  if(!multiCustomerEnabled(t.organizationId)||!t.portalCustomerScope)return {enabled:false};
  const s=await assertCurrentPortalScope(this.db.getClient(),t.portalCustomerScope);
  return {enabled:true,organizationId:s.organizationId,customerId:s.customerId,customers:s.customers,units:s.units};
 }
 private async manage(t:TenantContext,action:string,body:any){
  if(!['admin_org','gestor'].includes(t.role)&&t.accessMode!=='platform_operation')throw new ForbiddenException('Exige administração dos acessos externos.');
  if(!t.permissions.includes('f60e405e-f120-4420-a563-691162504b15')||!t.permissions.includes('8c5673e4-115c-4ab7-bb11-3b410eddcad3'))throw new ForbiddenException('Sem permissão para consultar os vínculos do Portal.');
  if(!multiCustomerEnabled(t.organizationId))return {enabled:false};
  const r=await this.db.getClient().rpc('manage_portal_customer_access',{p_org:t.organizationId,p_actor:t.userId,p_platform:t.accessMode==='platform_operation',p_action:action,p_body:body});
  if(r.error?.code==='42501')throw new ForbiddenException('Cliente, usuário, licença ou permissão indisponível.');
  if(['22023','22P02','23514'].includes(r.error?.code))throw new BadRequestException('Confira usuário, cliente, unidades e justificativa.');
  if(r.error?.code==='P3411')throw new BadRequestException('O limite de usuários deste cliente foi atingido.');
  if(r.error)throw new ServiceUnavailableException('O acesso não foi confirmado. Atualize e confira a revisão antes de repetir.');
  return {enabled:true,...r.data};
 }
 @Get('access-grants') @Header('Cache-Control','private, no-store') grants(@Tenant() t:TenantContext){return this.manage(t,'list',{});}
 @Post('access-grants') save(@Tenant() t:TenantContext,@Body() body:unknown){return this.requests.submitPortal(body,t);}
}
