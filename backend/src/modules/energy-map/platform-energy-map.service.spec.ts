import {PlatformEnergyMapService,platformMapQuery} from './platform-energy-map.service';
import {PERMISSIONS} from '../../common/constants/permissions';
import {PlatformEnergyMapController} from './platform-energy-map.controller';
import {PLATFORM_SCOPE_KEY} from '../../common/decorators/platform-scope.decorator';
const actor:any={scope:'global',role:'admin_platform',userId:'00000000-0000-4000-8000-000000000001',permissions:[PERMISSIONS.PLATFORM_ORGANIZATIONS_VIEW]};
describe('Platform energy map boundaries',()=>{
 let rpc:jest.Mock,service:PlatformEnergyMapService;
 beforeEach(()=>{rpc=jest.fn().mockResolvedValue({data:{scope:'global',total:0,rows:[]}});service=new PlatformEnergyMapService({getClient:()=>({rpc})} as any,{get:()=> 'true'} as any);});
 it('uses the explicitly global controller boundary',()=>{expect(Reflect.getMetadata(PLATFORM_SCOPE_KEY,PlatformEnergyMapController)).toBe(true);});
 it('denies organization roles and platform operation contexts',async()=>{for(const context of [{...actor,scope:'organization',accessMode:'platform_operation'},{...actor,role:'gestor'},{...actor,permissions:[]}])await expect(service.read({},context)).rejects.toThrow();expect(rpc).not.toHaveBeenCalled();});
 it('fails closed when disabled',async()=>{service=new PlatformEnergyMapService({getClient:()=>({rpc})} as any,{get:()=> ''} as any);await expect(service.read({},actor)).rejects.toThrow();expect(rpc).not.toHaveBeenCalled();});
 it('checks authoritative DB access revocation',async()=>{rpc.mockResolvedValue({error:{code:'42501'}});await expect(service.read({},actor)).rejects.toThrow('global indisponível');});
 it('bounds pages and forbids caller actor injection',()=>{for(const q of [{actorId:'other'},{limit:'501'},{offset:'-1'},{status:'ACTIVE'}])expect(()=>platformMapQuery(q)).toThrow();expect(platformMapQuery({location:'NO_UNIT'}).location).toBe('NO_UNIT');});
 it('calls only the private global RPC with authenticated actor',async()=>{await service.read({organizationId:'org',limit:'200'},actor);expect(rpc).toHaveBeenCalledWith('read_platform_energy_map',expect.objectContaining({p_actor:actor.userId,p_query:expect.objectContaining({organizationId:'org',limit:200})}));});
 it('rejects an organization-scoped or inconsistent provider response',async()=>{for(const data of [{scope:'organization',rows:[],total:0},{scope:'global',rows:[{organizationId:'other',hasUnit:true}],total:1}]){rpc.mockResolvedValue({data});await expect(service.read({organizationId:'org'},actor)).rejects.toThrow('carteira');}});
});
