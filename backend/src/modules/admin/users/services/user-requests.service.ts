import {BadRequestException,ConflictException,ForbiddenException,Injectable,ServiceUnavailableException} from '@nestjs/common';
import {randomUUID} from 'crypto';
import {SupabaseService} from '../../../../services/supabase.service';
import {TenantContext} from '../../../../common/interfaces/tenant-context.interface';
import {PERMISSIONS as P} from '../../../../common/constants/permissions';
import {UsersService} from './users.service';
const uuid=(v:unknown):v is string=>typeof v==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(v);
export function permissionSelection(value:unknown,role:string[],actor:string[]){
 if(!Array.isArray(value)||value.length>300||value.some(p=>!uuid(p))||new Set(value).size!==value.length)throw new BadRequestException('Selecione permissões válidas, sem duplicidade.');
 if(value.some(p=>!role.includes(p)||!actor.includes(p)))throw new ForbiddenException('Permissões superiores à função ou ao responsável.');
 return [...value].sort() as string[];
}
@Injectable()
export class UserRequestsService{
 constructor(private db:SupabaseService,private users:UsersService){}
 private allowed(t:TenantContext,write=false){
  if((t.scope as string)==='global'||!t.organizationId||!t.userId||!['admin_org','gestor'].includes(t.role)&&t.accessMode!=='platform_operation'||!t.permissions.includes(write?P.ORGANIZATION_USERS_INVITE:P.ORGANIZATION_USERS_VIEW))throw new ForbiddenException('Gestão de usuários indisponível neste contexto.');
 }
 private fail(r:any){if(!r.error)return r.data;if(r.error.code==='42501')throw new ForbiddenException('Acesso ou escopo da solicitação indisponível.');if(r.error.code==='40001'||r.error.code==='23505')throw new ConflictException('Solicitação já processada ou alterada. Atualize o histórico antes de repetir.');if(['22023','22P02','23514'].includes(r.error.code))throw new BadRequestException('Confira a seleção e a justificativa.');throw new ServiceUnavailableException('Resultado não confirmado. Consulte o histórico antes de repetir.');}
 private action(t:TenantContext,action:string,id:string,body:any){return this.db.getClient().rpc('organization_user_request_action',{o:t.organizationId,a:t.userId,platform:t.accessMode==='platform_operation',action,rid:id,b:body}).then((r:any)=>this.fail(r));}
 async catalog(t:TenantContext){
  this.allowed(t);const c=this.db.getClient();
  const [rs,ps,ms]=await Promise.all([c.from('roles').select('id,name,permissions').eq('organization_id',t.organizationId).eq('scope','organization'),c.from('permissions').select('id,code,name,module').in('id',t.permissions).order('code').limit(301),c.from('organization_members').select('user_id,role_id,permission_limit').eq('organization_id',t.organizationId).ilike('status','active').limit(501)]);
  const roles=this.fail(rs),permissions=this.fail(ps),members=this.fail(ms);if(!Array.isArray(roles)||!Array.isArray(permissions)||permissions.length>300||!Array.isArray(members)||members.length>500)throw new ServiceUnavailableException('Catálogo extenso ou indisponível. Nenhuma lista parcial foi apresentada.');
  const units=t.permissions.includes(P.ORGANIZATION_CONSUMER_UNITS_VIEW)?this.fail(await c.from('consumer_units').select('id,customer_id,name,consumer_unit_number').eq('organization_id',t.organizationId).ilike('status','active').limit(501)):[];
  const customers=t.permissions.includes(P.ORGANIZATION_CUSTOMERS_VIEW)?this.fail(await c.from('customers').select('id,company_name').eq('organization_id',t.organizationId).is('deleted_at',null).limit(501)):[];
  if(!Array.isArray(customers)||customers.length>500)throw new BadRequestException('Lista de clientes extensa. Consulte a administração.');
  if(!Array.isArray(units)||units.length>500)throw new BadRequestException('Lista de unidades extensa. Consulte a administração.');
  return {units,customers,roles:roles.filter((r:any)=>(r.name!=='admin_org'||t.accessMode==='platform_operation')&&Array.isArray(r.permissions)&&r.permissions.every((p:string)=>t.permissions.includes(p))),permissions:permissions.filter((p:any)=>t.permissions.includes(p.id)),members,canApprove:t.role==='admin_org'||t.accessMode==='platform_operation'};
 }
 async list(t:TenantContext,query:Record<string,string>={}){
  this.allowed(t);const page=Number(query.page??0);if(Object.keys(query).some(k=>!['page','state'].includes(k))||!Number.isInteger(page)||page<0||page>10000||query.state&&!['PENDING','ALL'].includes(query.state))throw new BadRequestException('Filtro de solicitações inválido.');let q=this.db.getClient().from('organization_user_requests').select('id,actor_id,kind,body,state,decision_by,decision_reason,result,created_at,updated_at').eq('organization_id',t.organizationId);
  if(t.role!=='admin_org'&&t.accessMode!=='platform_operation')q=q.eq('actor_id',t.userId);
  if(query.state==='PENDING')q=q.eq('state','PENDING');
  const rows=this.fail(await q.order('created_at',{ascending:false}).order('id').range(page*50,page*50+49));if(!Array.isArray(rows)||rows.length>50)throw new ServiceUnavailableException('Histórico indisponível.');return {rows,page,hasMore:rows.length===50,canApprove:t.role==='admin_org'||t.accessMode==='platform_operation'};
 }
 private async role(t:TenantContext,id:string,selected:unknown){
  await this.users.assertAssignable(id,t.organizationId,t.permissions,t.accessMode==='platform_operation');
  const role=this.fail(await this.db.getClient().from('roles').select('id,name,permissions').eq('organization_id',t.organizationId).eq('scope','organization').eq('id',id).single());
  return {role,permissions:permissionSelection(selected??role.permissions,role.permissions,t.permissions)};
 }
 async submitInvite(dto:any,t:TenantContext){
  this.allowed(t,true);const {permissions,role}=await this.role(t,dto.roleId,dto.permissionIds);
  if(dto.customerId&&role.name!=='consulta'||dto.portalUnitIds&&!dto.customerId)throw new BadRequestException('O Portal exige função Consulta, cliente e unidades autorizadas.');
  if(dto.customerId)await this.portalUnits(dto,t);
  const {requestId,permissionIds,...invite}=dto;const id=requestId??randomUUID();if(!uuid(id))throw new BadRequestException('Identificador inválido.');
  const row=await this.action(t,'submit',id,{kind:'INVITE',body:{...invite,permissionIds:permissions}});
  return {pendingApproval:true,request:row,message:'Solicitação encaminhada ao administrador da organização para aprovação. O acesso e o convite ainda não foram liberados.'};
 }
 private async portalUnits(dto:any,t:TenantContext){
  if(dto.affiliationType!=='external'||!Array.isArray(dto.portalUnitIds)||!dto.portalUnitIds.length||dto.portalUnitIds.length>100||new Set(dto.portalUnitIds).size!==dto.portalUnitIds.length||dto.portalUnitIds.some((v:any)=>!uuid(v)))throw new BadRequestException('Selecione as unidades autorizadas para o usuário externo do Portal.');
  const rows=this.fail(await this.db.getClient().from('consumer_units').select('id').eq('organization_id',t.organizationId).eq('customer_id',dto.customerId).ilike('status','active').in('id',dto.portalUnitIds));
  if(!Array.isArray(rows)||rows.length!==dto.portalUnitIds.length)throw new ForbiddenException('Unidades fora do cliente ou da organização.');
 }
 async submitPermissions(input:any,t:TenantContext){
  this.allowed(t,true);if(!input||Object.keys(input).sort().join(',')!=='permissionIds,reason,requestId,roleId,userId'||!uuid(input.userId)||!uuid(input.requestId)||!uuid(input.roleId)||typeof input.reason!=='string'||input.reason.trim().length<10||input.reason.length>1000||input.userId===t.userId)throw new BadRequestException('Informe usuário, função, permissões e justificativa. Alteração do próprio acesso exige outro administrador.');
  const {permissions}=await this.role(t,input.roleId,input.permissionIds);
  const target=this.fail(await this.db.getClient().from('organization_members').select('user_id,role_id,permission_limit,affiliation_type').eq('organization_id',t.organizationId).eq('user_id',input.userId).ilike('status','active').single());
  return {pendingApproval:true,request:await this.action(t,'submit',input.requestId,{kind:'PERMISSIONS',body:{userId:input.userId,roleId:input.roleId,permissionIds:permissions,reason:input.reason.trim(),expected:{roleId:target.role_id,permissionLimit:target.permission_limit}}})};
 }
 async submitPortal(input:any,t:TenantContext){
  this.allowed(t,true);if(!input||!uuid(input.requestId)||!uuid(input.userId)||!uuid(input.customerId)||!Array.isArray(input.unitIds)||input.unitIds.some((id:any)=>!uuid(id))||typeof input.active!=='boolean'||typeof input.reason!=='string'||input.reason.trim().length<10||input.reason.length>1000||!Number.isInteger(input.revision)||input.revision<0||Object.keys(input).sort().join(',')!=='active,customerId,reason,requestId,revision,unitIds,userId')throw new BadRequestException('Confira usuário, unidades e justificativa.');
  if(!t.permissions.includes('8c5673e4-115c-4ab7-bb11-3b410eddcad3'))throw new ForbiddenException('Sem permissão para os vínculos do Portal.');
  return {pendingApproval:true,request:await this.action(t,'submit',input.requestId,{kind:'PORTAL_GRANT',body:input})};
 }
 async decide(id:string,b:any,t:TenantContext){
  this.allowed(t,true);if(t.role!=='admin_org'&&t.accessMode!=='platform_operation')throw new ForbiddenException('A aprovação exige administrador da organização.');
  if(!uuid(id)||!b||Object.keys(b).sort().join(',')!=='decision,reason'||!['APPROVE','REJECT'].includes(b.decision)||typeof b.reason!=='string'||b.reason.trim().length<10||b.reason.length>1000)throw new BadRequestException('Confirme a decisão e justifique.');
  const source=this.fail(await this.db.getClient().from('organization_user_requests').select('*').eq('organization_id',t.organizationId).eq('id',id).single());
  if(source.state!=='PENDING')return {request:source,replayed:true};
  if(b.decision==='REJECT')return {request:await this.action(t,'reject',id,{reason:b.reason.trim()})};
  // Revalidate the current delegation before claiming; no emails or grants occur before this point.
  if(source.kind!=='PORTAL_GRANT')await this.role(t,source.body.roleId,source.body.permissionIds);
  if(source.kind==='INVITE'&&source.body.customerId)await this.portalUnits(source.body,t);
  if(source.kind==='PERMISSIONS'){
   if(!t.permissions.includes(P.ORGANIZATION_USERS_UPDATE))throw new ForbiddenException('Sem permissão para alterar usuários.');
   const current=this.fail(await this.db.getClient().from('organization_members').select('role_id,permission_limit').eq('organization_id',t.organizationId).eq('user_id',source.body.userId).ilike('status','active').single());
   if(JSON.stringify({roleId:current.role_id,permissionLimit:current.permission_limit})!==JSON.stringify(source.body.expected))throw new ConflictException('O acesso mudou após a solicitação. Rejeite esta versão e prepare outra solicitação.');
  }
  if(source.kind==='PORTAL_GRANT'&&!t.permissions.includes(P.ORGANIZATION_LICENSES_VIEW))throw new ForbiddenException('Sem permissão para os vínculos do Portal.');
  await this.action(t,'claim',id,{reason:b.reason.trim()});
  try{
   let result:any;
   if(source.kind==='INVITE'){
    if(source.body.customerId)await this.portalUnits(source.body,t);
    result=await this.users.invite(source.body,{actorUserId:t.userId,organizationId:t.organizationId});
    if(source.body.customerId){
     const grant={requestId:id,userId:result.userId,customerId:source.body.customerId,unitIds:source.body.portalUnitIds,active:true,revision:0,reason:b.reason.trim()};
     this.fail(await this.db.getClient().rpc('manage_portal_customer_access',{p_org:t.organizationId,p_actor:t.userId,p_platform:t.accessMode==='platform_operation',p_action:'save',p_body:grant}));
     if(result.provisioningPath==='existing_identity')result={...result,...await this.users.notifyPortalScope(grant,t,id)};
    }
   }
   else if(source.kind==='PERMISSIONS'){
    if(!t.permissions.includes(P.ORGANIZATION_USERS_UPDATE))throw new ForbiddenException('Sem permissão para alterar usuários.');
    const current=this.fail(await this.db.getClient().from('organization_members').select('role_id,permission_limit').eq('organization_id',t.organizationId).eq('user_id',source.body.userId).ilike('status','active').single());
    if(JSON.stringify({roleId:current.role_id,permissionLimit:current.permission_limit})!==JSON.stringify(source.body.expected))throw new ConflictException('O acesso mudou após a solicitação. Prepare outra solicitação.');
    this.fail(await this.db.getClient().rpc('set_member_permission_limit',{o:t.organizationId,a:t.userId,platform:t.accessMode==='platform_operation',u:source.body.userId,roleid:source.body.roleId,selected:source.body.permissionIds,reason:b.reason.trim(),expected:source.body.expected}));
    result={updated:true};
   }else if(source.kind==='PORTAL_GRANT'){
    if(!t.permissions.includes('8c5673e4-115c-4ab7-bb11-3b410eddcad3'))throw new ForbiddenException('Sem permissão para os vínculos do Portal.');
    result=this.fail(await this.db.getClient().rpc('manage_portal_customer_access',{p_org:t.organizationId,p_actor:t.userId,p_platform:t.accessMode==='platform_operation',p_action:'save',p_body:source.body}));
    result={...result,...await this.users.notifyPortalScope(source.body,t,id)};
   }else throw new BadRequestException('Tipo de solicitação indisponível.');
   return {request:await this.action(t,'complete',id,{result})};
  }catch(e){
   try{await this.action(t,'unknown',id,{reason:'Resultado da execução não confirmado. Conferir vínculos, auditoria e provedor antes de qualquer retomada.'});}catch{/* Do not repeat a potentially delivered invitation. */}
   throw e;
  }
 }
}
