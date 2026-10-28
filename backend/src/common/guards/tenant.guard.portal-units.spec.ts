import {TenantGuard} from './tenant.guard';
const scope={enabled:true,organizationId:'org',userId:'actor',roleId:'reader',customerId:'b',revision:'a'.repeat(32),allUnits:false,units:[{id:'b1',name:'Unit B1',number:'1'}],customers:[{id:'b',name:'Company B'}]};
function fixture(path='/api/v1/portal/financial',header:any='b',result:any={data:scope}){
 const member={user_id:'actor',organization_id:'org',role_id:'reader',status:'active',affiliation_type:'external',exclusive_customer_id:'a',portal_scope_managed:true,roles:{id:'reader',name:'consulta',scope:'organization',organization_id:'org',permissions:[]}};
 const rpc=jest.fn(async(..._args:any[])=>result),client={rpc,auth:{getUser:async()=>({data:{user:{id:'actor'}}})},from:(table:string)=>{const q:any={select:()=>q,eq:()=>q,single:async()=>({data:table==='user_profiles'?{organization_id:'org'}:table==='organizations'?{id:'org',deleted_at:null}:member})};return q;}};
 const guard=new TenantGuard({getAllAndOverride:()=>false,get:()=>false} as any,{getClient:()=>client} as any),req:any={headers:{authorization:'Bearer synthetic',...(header===undefined?{}:{'x-portal-customer':header})},path,method:'GET'};
 return {req,rpc,run:()=>guard.canActivate({getClass:()=>class Test{},getHandler:()=>function test(){},switchToHttp:()=>({getRequest:()=>req})} as any)};
}
describe('Selected portal customer and unit authority',()=>{
 const old={enabled:process.env.PORTAL_MULTI_CUSTOMER_ENABLED,orgs:process.env.PORTAL_MULTI_CUSTOMER_ORGANIZATIONS};
 beforeEach(()=>{process.env.PORTAL_MULTI_CUSTOMER_ENABLED='true';process.env.PORTAL_MULTI_CUSTOMER_ORGANIZATIONS='org';});
 afterAll(()=>{for(const [key,value] of [['PORTAL_MULTI_CUSTOMER_ENABLED',old.enabled],['PORTAL_MULTI_CUSTOMER_ORGANIZATIONS',old.orgs]])if(value===undefined)delete process.env[key!];else process.env[key!]=value;});
 it('attaches only the server-validated selected grant',async()=>{const f=fixture();await expect(f.run()).resolves.toBe(true);expect(f.req.tenantContext.portalCustomerScope).toEqual(scope);expect(f.rpc).toHaveBeenCalledWith('portal_customer_scope',{p_org:'org',p_actor:'actor',p_role:'reader',p_customer:'b'});});
 it.each([['b','foreign'],['b','b']])('rejects a forged actor/organization response',async(header,customer)=>{const f=fixture(undefined,header,{data:{...scope,customerId:customer,userId:'foreign'}});await expect(f.run()).rejects.toMatchObject({status:503});});
 it('rejects repeated or malformed selection headers',async()=>{for(const header of [['a','b'],'../foreign'])await expect(fixture(undefined,header).run()).rejects.toMatchObject({status:403});});
 it('does not misreport a database outage as an expired login',async()=>{await expect(fixture(undefined,'b',{error:{code:'08006'}}).run()).rejects.toMatchObject({status:503});});
 it('fails closed for managed grants when the rollout is off, retaining identity access',async()=>{process.env.PORTAL_MULTI_CUSTOMER_ENABLED='false';await expect(fixture().run()).rejects.toMatchObject({status:403});await expect(fixture('/api/v1/auth/context').run()).resolves.toBe(true);});
 it('never carries a stale selection into discovery',async()=>{const f=fixture('/api/v1/portal/customers');await f.run();expect(f.rpc.mock.calls[0][1].p_customer).toBeNull();});
 it('keeps external users out of access administration',async()=>{await expect(fixture('/api/v1/portal/access-grants').run()).rejects.toMatchObject({status:403});});
});
