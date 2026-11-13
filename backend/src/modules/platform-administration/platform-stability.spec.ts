import {PlatformAdministrationService,administrationQuery} from './platform-administration.service';
import {PlatformAdministrationController} from './platform-administration.controller';
import {PERMISSIONS_KEY} from '../../common/decorators/require-permission.decorator';
const actor='00000000-0000-4000-8000-000000000001';
const setup=()=>{const rpc=jest.fn().mockResolvedValue({data:{responsible:'OWNER',rows:[],total:0}});return {rpc,s:new PlatformAdministrationService({getClient:()=>({rpc})} as any,{} as any)};};
describe('Owner stability gateway',()=>{
 it('uses only the authenticated actor, fixed page size and read-only RPC',async()=>{const {s,rpc}=setup();const r=await s.stability(actor,{page:'2',search:' Expert '});expect(rpc).toHaveBeenCalledWith('platform_eva_stability',{p_actor:actor,p_search:'Expert',p_offset:50});expect(r.plan.steps.map((s:{id:string})=>s.id)).toEqual(['A','B','C','D','E','F','G']);expect(r.plan.steps.find((s:{id:string})=>s.id==='G')?.status).toBe('Não atingida');});
 it.each([{organizationId:'other'},{actor:'other'},{search:['x']},{page:'1001'},{search:'x'.repeat(151)}])('rejects client scope/actor overrides %j',async q=>{const {s,rpc}=setup();await expect(s.stability(actor,q as any)).rejects.toThrow();expect(rpc).not.toHaveBeenCalled();});
 it('returns access denial without retry or stale data',async()=>{const {s,rpc}=setup();rpc.mockResolvedValue({error:{code:'42501'}});await expect(s.stability(actor,{})).rejects.toThrow('exclusivo');expect(rpc).toHaveBeenCalledTimes(1);});
 it('does not treat an invalid filter or malformed response as healthy',async()=>{const {s,rpc}=setup();rpc.mockResolvedValue({error:{code:'22023'}});await expect(s.stability(actor,{})).rejects.toThrow('Filtros');rpc.mockResolvedValue({data:{rows:[]}});await expect(s.stability(actor,{})).rejects.toThrow('indisponível');});
 it('uses the current actor supplied by the platform-authenticated request',()=>{const stability=jest.fn();new PlatformAdministrationController({stability} as any).stability({authenticatedUser:{userId:actor}} as any,{search:'x'});expect(stability).toHaveBeenCalledWith(actor,{search:'x'});expect(Reflect.getMetadata(PERMISSIONS_KEY,PlatformAdministrationController.prototype.stability)).toEqual(['82e7fc71-479a-4dd6-8b22-4fba6eaa6841']);});
 it('validates the monitoring query independently of other administration filters',()=>{expect(administrationQuery('stability',{})).toEqual({page:0,filter:{}});expect(()=>administrationQuery('stability',{status:'ACTIVE'})).toThrow();});
});
