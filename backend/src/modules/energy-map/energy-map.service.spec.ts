import {EnergyMapService} from './energy-map.service';
import {MAP_VIEW,MAP_CUSTOMERS,MAP_MANAGE,locationInput,mapQuery} from './energy-map.validation';
const actor:any={organizationId:'o1',userId:'a1',role:'gestor',permissions:[MAP_VIEW,MAP_CUSTOMERS,MAP_MANAGE]};
describe('Energy map boundaries',()=>{
 let service:EnergyMapService;let rpc:jest.Mock;let licenses:any;
 beforeEach(()=>{rpc=jest.fn().mockResolvedValue({data:{rows:[],total:0},error:null});licenses={resolveEffectiveLicense:jest.fn().mockResolvedValue({id:'l1'})};service=new EnergyMapService({getClient:()=>({rpc})} as any,licenses,{get:()=> 'o1'} as any);});
 it('requires both read permissions and backoffice audience',async()=>{for(const t of [{...actor,permissions:[MAP_VIEW]},{...actor,role:'consulta'},{...actor,organizationId:''}])await expect(service.access(t)).rejects.toThrow();expect(rpc).not.toHaveBeenCalled();});
 it('blocks expired licenses before querying',async()=>{licenses.resolveEffectiveLicense.mockResolvedValue(null);await expect(service.units({},actor)).rejects.toThrow();expect(rpc).not.toHaveBeenCalled();});
 it('rejects a cross-tenant response',async()=>{rpc.mockResolvedValueOnce({error:null}).mockResolvedValueOnce({data:{rows:[{organizationId:'o2'}],total:1}});await expect(service.units({},actor)).rejects.toThrow('fora do escopo');});
 it('rechecks live DB actor access',async()=>{rpc.mockResolvedValue({error:{code:'42501'}});await expect(service.access(actor)).rejects.toThrow('licença ativa');});
 it('does not permit a write using read access',async()=>{await expect(service.save('u1',{}, {...actor,permissions:[MAP_VIEW,MAP_CUSTOMERS]})).rejects.toThrow();expect(rpc).toHaveBeenCalledTimes(1);});
 it('fails closed with the feature flag off',async()=>{service=new EnergyMapService({getClient:()=>({rpc})} as any,licenses,{get:()=> ''} as any);await expect(service.units({},actor)).rejects.toThrow();expect(rpc).toHaveBeenCalledTimes(1);});
 it('bounds pagination and rejects unknown scope fields',()=>{expect(()=>mapQuery({organizationId:'o2'})).toThrow();expect(()=>mapQuery({limit:'501'})).toThrow();expect(()=>mapQuery({offset:'-1'})).toThrow();expect(mapQuery({limit:'200'}).limit).toBe(200);});
 it('requires finite coordinates, confirmation, fingerprint and exact fields',()=>{const b={latitude:-21,longitude:-47,precision:'ADDRESS',reason:'Fonte conferida',revision:0,requestId:'00000000-0000-4000-8000-000000000001',checkedAddress:true,addressHash:'a'.repeat(32)};expect(locationInput(b).reason).toBe('Fonte conferida');for(const invalid of [{...b,latitude:NaN},{...b,longitude:Infinity},{...b,latitude:0,longitude:0},{...b,checkedAddress:false},{...b,addressHash:''},{...b,organizationId:'o2'}])expect(()=>locationInput(invalid)).toThrow();});
});
