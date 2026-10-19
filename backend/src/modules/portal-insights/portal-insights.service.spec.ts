import {PortalInsightsService} from './portal-insights.module';
describe('published client insight authorization',()=>{
 const tenant:any={organizationId:'org',userId:'user',roleId:'role',role:'consulta'};
 function fixture(binding:any={enabled:true,organizationId:'org',customerId:'client'},rows:any[]=[]){
  const rpc=jest.fn().mockResolvedValueOnce({data:binding,error:null}).mockResolvedValueOnce({data:rows,error:null});
  return {rpc,service:new PortalInsightsService({getClient:()=>({rpc})} as any)};
 }
 it('rejects internal and platform callers before reading any data',async()=>{
  const {rpc,service}=fixture();
  await expect(service.read({...tenant,role:'admin_org'},'2026-09','2026-09')).rejects.toThrow();
  await expect(service.read({...tenant,accessMode:'platform'},'2026-09','2026-09')).rejects.toThrow();
  expect(rpc).not.toHaveBeenCalled();
 });
 it('does not read components after entitlement revocation',async()=>{
  const {rpc,service}=fixture({enabled:false});
  await expect(service.read(tenant,'2026-09','2026-09')).rejects.toThrow();
  expect(rpc).toHaveBeenCalledTimes(1);
 });
 it('derives customer from the current entitlement and binds the private RPC',async()=>{
  const {rpc,service}=fixture();
  expect(await service.read(tenant,'2026-09','2026-09')).toMatchObject({customerId:'client',rows:[]});
  expect(rpc.mock.calls[1]).toEqual(['read_eva_published_components',{p_org:'org',p_actor:'user',p_role:'role',p_platform:false,p_portal:true,p_from:'2026-09',p_to:'2026-09',p_customer:'client'}]);
 });
 it('rejects a foreign publication instead of returning any partial data',async()=>{
  const {service}=fixture(undefined,[{customerId:'other',month:'2026-09',unitId:'unit'}]);
  await expect(service.read(tenant,'2026-09','2026-09')).rejects.toThrow();
 });
 it('rejects an excessive or malformed period before accessing the database',async()=>{
  const {service,rpc}=fixture();
  await expect(service.read(tenant,'2025-01','2026-09')).rejects.toThrow();
  await expect(service.read(tenant,'2026-13','2026-13')).rejects.toThrow();
  expect(rpc).not.toHaveBeenCalled();
 });
});
