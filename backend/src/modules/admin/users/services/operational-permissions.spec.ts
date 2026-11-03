import {ForbiddenException} from '@nestjs/common';
import {UserRequestsService} from './user-requests.service';
import {UsersController} from '../controllers/users.controller';
import {PERMISSIONS as P} from '../../../../common/constants/permissions';
import {TradingHubService,TRADING_VIEW,TRADING_SUPPLIERS_MANAGE} from '../../../trading-hub/trading-hub.service';
const actor='11111111-1111-4111-8111-111111111111';
const tenant=(role:string):any=>({scope:'organization',organizationId:'org-a',userId:actor,role,roleId:actor,permissions:Object.values(P)});
describe('Administrator-only account management and operational access',()=>{
 it.each(['gestor','operacional','consulta'])('denies %s before every management RPC even with legacy permission UUIDs',async role=>{
  const db:any={getClient:jest.fn()},users:any={invite:jest.fn()};const service=new UserRequestsService(db,users),t=tenant(role);
  for(const operation of [()=>service.catalog(t),()=>service.list(t),()=>service.submitInvite({},t),()=>service.submitPermissions({},t),()=>service.submitPortal({},t),()=>service.configureRole(actor,{},t),()=>service.decide(actor,{},t)])await expect(operation()).rejects.toBeInstanceOf(ForbiddenException);
  expect(db.getClient).not.toHaveBeenCalled();expect(users.invite).not.toHaveBeenCalled();
 });
 it.each(['gestor','operacional','consulta'])('denies direct user-account endpoints for %s',async role=>{
  const service:any={assertAssignable:jest.fn(),invite:jest.fn(),notifyExistingMember:jest.fn(),updateDetails:jest.fn(),setMembershipStatus:jest.fn(),deactivate:jest.fn(),updateRole:jest.fn(),updateAffiliation:jest.fn()};
  const controller=new UsersController(service,{submitInvite:jest.fn()} as any),t=tenant(role),request:any={ip:'test',get:()=>''};
  for(const operation of [()=>controller.invite({} as any,t,request),()=>controller.notification(actor,t),()=>controller.details(actor,{} as any,t,request),()=>controller.status(actor,{} as any,t,request),()=>controller.deactivate(actor,t,request),()=>controller.updateRole(actor,{} as any,t,request),()=>controller.updateAffiliation(actor,{} as any,t,request)])await expect(operation()).rejects.toBeInstanceOf(ForbiddenException);
  for(const fn of Object.values(service))expect(fn).not.toHaveBeenCalled();
 });
 it('keeps role configuration scoped to the authoritative tenant and revision',async()=>{
  const rpc=jest.fn().mockResolvedValue({data:{roleId:actor,existingMembershipsPreserved:4},error:null});const service=new UserRequestsService({getClient:()=>({rpc})} as any,{} as any),t=tenant('admin_org');
  await service.configureRole(actor,{revision:'a'.repeat(32),permissionIds:[P.DOCUMENTS_VIEW,P.DOCUMENTS_UPLOAD],reason:'Operational options reviewed by administrator'},t);
  expect(rpc).toHaveBeenCalledWith('configure_organization_role_permissions',expect.objectContaining({o:'org-a',a:actor,platform:false,roleid:actor,expected:'a'.repeat(32)}));
  await expect(service.configureRole(actor,{revision:'a'.repeat(32),permissionIds:[],reason:'A valid explanation',organizationId:'org-b'},t)).rejects.toThrow();expect(rpc).toHaveBeenCalledTimes(1);
 });
 it('supplier-only permission never authorizes ordinary Trading writes or unlicensed use',async()=>{
  const licenses={requireEntitlement:jest.fn().mockResolvedValue({})};const service=new TradingHubService({getClient:jest.fn()} as any,licenses as any),t={...tenant('operacional'),permissions:[TRADING_VIEW,TRADING_SUPPLIERS_MANAGE]};
  await expect(service.allowed(t,true,true)).resolves.toBeUndefined();
  await expect(service.allowed(t,true)).rejects.toBeInstanceOf(ForbiddenException);
  licenses.requireEntitlement.mockRejectedValue(new ForbiddenException('Trading Hub not licensed'));
  await expect(service.allowed(t,true,true)).rejects.toThrow('not licensed');
 });
 it('supplier-only permission cannot invoke invitation dispatch/revoke or contracting through the shared write guard',async()=>{
  const db:any={getClient:jest.fn()};const service=new TradingHubService(db,{requireEntitlement:jest.fn()} as any),t={...tenant('operacional'),permissions:[TRADING_VIEW,TRADING_SUPPLIERS_MANAGE]};
  await expect(service.contract(actor,{},t)).rejects.toBeInstanceOf(ForbiddenException);
  await expect(service.save('opportunity',null,{},t)).rejects.toBeInstanceOf(ForbiddenException);expect(db.getClient).not.toHaveBeenCalled();
 });
});
