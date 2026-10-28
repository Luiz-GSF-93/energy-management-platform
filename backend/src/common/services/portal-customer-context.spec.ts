import {portalRequestScope,scopedPortalClient,validatePortalContext,assertCurrentPortalScope} from './portal-customer-context';
import {TenantInterceptor} from '../interceptors/tenant.interceptor';
import {of,lastValueFrom} from 'rxjs';
const scope=(customerId='a')=>({enabled:true as const,organizationId:'org',userId:'actor',roleId:'reader',customerId,revision:'a'.repeat(32),allUnits:false,units:[{id:customerId+'1',name:'Unit',number:'123'}],customers:[{id:customerId,name:'Client'}]});
describe('Portal customer request isolation',()=>{
 it('validates the authoritative actor, organization and unit set',()=>{const s=scope();expect(validatePortalContext(s,'org','actor','reader')).toEqual(s);for(const value of [{...s,userId:'foreign'},{...s,organizationId:'foreign'},{...s,roleId:'manager'},{...s,units:[]},{...s,units:[...s.units,...s.units]},{...s,customers:[]}])expect(()=>validatePortalContext(value,'org','actor','reader')).toThrow();});
 it('never shares a selected customer between concurrent requests',async()=>{
  const sent:any[]=[];const raw={rpc:jest.fn(async(name,args)=>{sent.push([name,args]);return {data:{}};}),from:jest.fn()};
  await Promise.all(['a','b'].map(customer=>portalRequestScope.run(scope(customer),async()=>{await new Promise(resolve=>setTimeout(resolve,customer==='a'?5:1));const s=portalRequestScope.getStore()!;await scopedPortalClient(raw,s).rpc('portal_presentation_action',{p_org:'org',p_actor:'actor'});})));
  expect(sent.map(x=>x[1].p_customer).sort()).toEqual(['a','b']);expect(sent.every(x=>x[0]==='portal_scoped_rpc')).toBe(true);expect(portalRequestScope.getStore()).toBeUndefined();
 });
 it('does not let a changed grant return a response already prepared',async()=>{
  const s=scope(),db={getClient:()=>({rpc:async()=>({data:{...s,revision:'b'.repeat(32)}})})};
  const interceptor=new TenantInterceptor({get:()=>false} as any,db as any),ctx={getHandler:()=>()=>{},switchToHttp:()=>({getRequest:()=>({method:'GET',path:'/portal/financial',tenantContext:{organizationId:'org',portalCustomerScope:s}})})};
  await expect(lastValueFrom(interceptor.intercept(ctx as any,{handle:()=>of({privateFinancialData:true})}))).rejects.toMatchObject({status:403});
 });
 it('preserves read-only provider outages as unavailable rather than revoked',async()=>{await expect(assertCurrentPortalScope({rpc:async()=>({error:{code:'08006'}})},scope())).rejects.toMatchObject({status:503});});
 it('revalidates the selected scope without routing its own validation recursively',async()=>{const rpc=jest.fn(async(..._args:any[])=>({data:scope()}));await scopedPortalClient({rpc},scope()).rpc('portal_customer_scope',{p_org:'org'});expect(rpc.mock.calls[0][0]).toBe('portal_customer_scope');});
});
