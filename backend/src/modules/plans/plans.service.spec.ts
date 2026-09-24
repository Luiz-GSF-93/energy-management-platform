import {PlansService,PLAN_MANAGE,PLAN_VIEW} from './plans.service';
import {OrganizationPlansController,PlatformPlansController} from './plans.controller';
import {PERMISSIONS_KEY} from '../../common/decorators/require-permission.decorator';
import {PLATFORM_SCOPE_KEY} from '../../common/decorators/platform-scope.decorator';
import {PERMISSIONS as P} from '../../common/constants/permissions';
describe('Plan request boundaries',()=>{
 let service:PlansService,rpc:jest.Mock;
 beforeEach(()=>{rpc=jest.fn().mockResolvedValue({data:{id:'license',organization_id:'org-a'},error:null});service=new PlansService({getClient:()=>({rpc})} as any);});
 const dto={planId:'plan',version:2,startDate:'2026-09-24',renewalDate:'2027-09-24'};
 it('binds application to authenticated organization and actor',async()=>{await service.apply('org-a',dto,{userId:'actor'});expect(rpc).toHaveBeenCalledWith('create_license_from_plan',expect.objectContaining({target_organization:'org-a',actor_id:'actor',target_plan:'plan',expected_version:2}));});
 it('rejects a foreign organization in the RPC result',async()=>{rpc.mockResolvedValue({data:{id:'x',organization_id:'other'}});await expect(service.apply('org-a',dto,{userId:'actor'})).rejects.toThrow();});
 it('rejects invalid dates before writing',async()=>{await expect(service.apply('org-a',{...dto,endDate:'2025-01-01'},{userId:'actor'})).rejects.toThrow();expect(rpc).not.toHaveBeenCalled();});
 it('requires a version when editing',async()=>{await expect(service.save('plan',{} as any,{userId:'actor'})).rejects.toThrow();expect(rpc).not.toHaveBeenCalled();});
 it.each(['P3151','P3152','23P01','23505'])('returns a conflict for %s',async code=>{rpc.mockResolvedValue({error:{code}});await expect(service.apply('org-a',dto,{userId:'actor'})).rejects.toMatchObject({status:409});});
 it('hides internal database errors',async()=>{rpc.mockResolvedValue({error:{message:'secret'}});await expect(service.apply('org-a',dto,{userId:'actor'})).rejects.toThrow('Não foi possível');});
 it('requires platform scope and dedicated permissions',()=>{
  expect(Reflect.getMetadata(PLATFORM_SCOPE_KEY,PlatformPlansController)).toBe(true);
  expect(Reflect.getMetadata(PERMISSIONS_KEY,PlatformPlansController.prototype.list)).toEqual([PLAN_VIEW]);
  for(const name of ['create','update'] as const)expect(Reflect.getMetadata(PERMISSIONS_KEY,PlatformPlansController.prototype[name])).toEqual([PLAN_MANAGE]);
  expect(Reflect.getMetadata(PERMISSIONS_KEY,OrganizationPlansController.prototype.create)).toEqual([P.ORGANIZATION_LICENSES_CREATE]);
 });
});
