import 'reflect-metadata';
import {RoleGuard} from '../../common/guards/role.guard';
import {PLATFORM_SCOPE_KEY} from '../../common/decorators/platform-scope.decorator';
import {PERMISSIONS_KEY} from '../../common/decorators/require-permission.decorator';
import {PlatformTeamController} from './platform-team.controller';
import {PlatformTeamService} from './platform-team.service';
import {TEAM_MANAGE,PLATFORM_SUPPORT_VIEW,PLATFORM_COSTS_VIEW} from './platform-team.permissions';
import {WhatsappDeliveryController,WhatsappTemplatesController} from '../whatsapp-delivery/whatsapp-delivery.controller';
import {IntegrationRenewalController} from '../dashboard/dashboard.controller';
import {PlatformCostsController} from '../platform-costs/platform-costs.controller';
describe('Platform team authorization',()=>{
 const dto:any={email:'new@example.com',firstName:'Ana',lastName:'Silva',profile:'OWNER',reason:'Cadastro autorizado'};
 const actor={userId:'11111111-1111-4111-8111-111111111111'};
 it.each(['list','insert','update'] as const)('only Owner in platform scope can %s',method=>{
  expect(Reflect.getMetadata(PLATFORM_SCOPE_KEY,PlatformTeamController)).toBe(true);
  expect(Reflect.getMetadata(PERMISSIONS_KEY,PlatformTeamController.prototype[method])).toEqual([TEAM_MANAGE]);
 });
 it.each([PLATFORM_COSTS_VIEW,PLATFORM_SUPPORT_VIEW,'9a679254-bb1a-4353-9d17-cc2bd9eb5abd'])('rejects role escalation for permission %s',async permission=>{
  const guard=new RoleGuard({get:(key:string)=>key===PERMISSIONS_KEY?[TEAM_MANAGE]:false} as any);
  const context:any={getHandler:()=>PlatformTeamController.prototype.insert,switchToHttp:()=>({getRequest:()=>({accessContext:{scope:'global',permissions:[permission]}})})};
  await expect(guard.canActivate(context)).rejects.toThrow('Acesso negado');
 });
 it('separates technical support from organization administration',()=>{
  for(const controller of [WhatsappDeliveryController,WhatsappTemplatesController])expect(Reflect.getMetadata(PERMISSIONS_KEY,controller.prototype.get)).toEqual([TEAM_MANAGE,PLATFORM_SUPPORT_VIEW]);
  expect(Reflect.getMetadata(PERMISSIONS_KEY,IntegrationRenewalController.prototype.save)).toEqual([TEAM_MANAGE]);
  expect(Reflect.getMetadata(PERMISSIONS_KEY,PlatformCostsController.prototype.policy)).not.toContain(PLATFORM_COSTS_VIEW);
 });
 it('does not create an identity when Owner authorization fails',async()=>{
  const auth=jest.fn(),service=new PlatformTeamService({getClient:()=>({rpc:async()=>({error:{code:'42501'}})}),createAuthClient:auth} as any);
  await expect(service.insert(dto,actor)).rejects.toThrow('Owner ativo');expect(auth).not.toHaveBeenCalled();
 });
 it('fails closed during profile lookup outage',async()=>{
  const auth=jest.fn(),client={rpc:async()=>({data:{authorized:true}}),from:()=>({select:()=>({eq:async()=>({error:{message:'private'}})})})};
  await expect(new PlatformTeamService({getClient:()=>client,createAuthClient:auth} as any).insert(dto,actor)).rejects.toThrow('indisponível');expect(auth).not.toHaveBeenCalled();
 });
 it('does not reinterpret provider identity without profile',async()=>{
  const invite=jest.fn(),client={rpc:async()=>({data:{authorized:true}}),from:()=>({select:()=>({eq:async()=>({data:[]})})})};
  const auth={auth:{admin:{listUsers:async()=>({data:{users:[{email:dto.email}],lastPage:1}}),inviteUserByEmail:invite}}};
  await expect(new PlatformTeamService({getClient:()=>client,createAuthClient:()=>auth} as any).insert(dto,actor)).rejects.toThrow('recuperação separada');expect(invite).not.toHaveBeenCalled();
 });
 it('rechecks authorization during the grant and never deletes on uncertain provider result',async()=>{
  const rpc=jest.fn().mockResolvedValueOnce({data:{authorized:true}}).mockResolvedValueOnce({error:{code:'42501'}}),remove=jest.fn();
  const client={rpc,from:()=>({select:()=>({eq:async()=>({data:[{user_id:'target',email:dto.email}]})})})};
  const auth={auth:{admin:{getUserById:async()=>({data:{user:{id:'target',email:dto.email}}}),deleteUser:remove}}};
  await expect(new PlatformTeamService({getClient:()=>client,createAuthClient:()=>auth} as any).insert(dto,actor)).rejects.toThrow('Owner ativo');expect(rpc).toHaveBeenLastCalledWith('save_platform_team_member',expect.objectContaining({p_actor:actor.userId,p_user:'target',p_new_identity:false}));expect(remove).not.toHaveBeenCalled();
 });
 it('preserves original IDs and revisions when saving',async()=>{
  const rpc=jest.fn().mockResolvedValue({data:{userId:'target'}}),service=new PlatformTeamService({getClient:()=>({rpc})} as any);
  await service.save('target',{firstName:' Ana ',lastName:' Silva ',profile:'SUPPORT',reason:' Motivo validado ',revision:3,active:false},actor);
  expect(rpc).toHaveBeenCalledWith('save_platform_team_member',expect.objectContaining({p_actor:actor.userId,p_user:'target',p_revision:3,p_active:false,p_first:'Ana',p_email:null}));
 });
});
