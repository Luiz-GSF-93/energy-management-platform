import {TenantGuard} from './tenant.guard';
import {restrictClientPortalRequest} from './client-portal-access';
const member={user_id:'actor',organization_id:'org',role_id:'role',status:'active',affiliation_type:'external',exclusive_customer_id:'customer',roles:{id:'role',name:'consulta',scope:'organization',organization_id:'org',permissions:['legacy-wide-permission']}};
function fixture(path:string,method='GET',patch:any={}){
 const row={...member,...patch};
 const client={auth:{getUser:async()=>({data:{user:{id:'actor'}},error:null})},from:(table:string)=>{const q:any={select:jest.fn().mockReturnThis(),eq:jest.fn().mockReturnThis(),single:async()=>({data:table==='user_profiles'?{organization_id:'org'}:table==='organizations'?{id:'org',deleted_at:null}:row,error:null})};return q;}};
 const guard=new TenantGuard({getAllAndOverride:()=>false,get:()=>false} as any,{getClient:()=>client} as any);
 const req:any={headers:{authorization:'Bearer token'},path,method};
 const ctx={getClass:()=>class Test{},getHandler:()=>function test(){},switchToHttp:()=>({getRequest:()=>req})} as any;
 return {run:()=>guard.canActivate(ctx),req};
}
describe('explicit client portal binding narrows backend access',()=>{
 it.each([['/api/v1/portal/license','GET'],['/api/v1/portal/energy-forecasts','GET'],['/api/v1/portal/energy-prices','GET'],['/api/v1/bot-energy/reports/client/units','GET'],['/api/v1/bot-energy/reports/client','POST'],['/api/v1/portal/evidence','GET'],['/api/v1/portal/evidence/11111111-1111-4111-8111-111111111111/upload','POST']])('preserves explicit client identity for the scoped module %s',async(path,method)=>{const f=fixture(path,method);await expect(f.run()).resolves.toBe(true);expect(f.req.tenantContext).toMatchObject({userId:'actor',organizationId:'org',role:'consulta'});});
 it.each(['/api/v1/portal/access','/api/v1/portal/financial','/api/v1/auth/context','/api/v1/auth/profile','/portal/financial/'])('allows only exact read route %s',async path=>{const f=fixture(path);await expect(f.run()).resolves.toBe(true);expect(f.req.tenantContext.userId).toBe('actor');});
 it.each(['/api/v1/documents','/api/v1/financial-settlements/published','/api/v1/portal/preview','/api/v1/portal/financial/other','/api/v1/portal/financial%2Fother','/api/v1/organization-members'])('blocks internal or nested route despite legacy permission %s',async path=>{await expect(fixture(path).run()).rejects.toThrow('portal do cliente');});
 it.each(['POST','PATCH','DELETE','PUT'])('blocks writes %s',async method=>{await expect(fixture('/api/v1/portal/financial',method).run()).rejects.toThrow();});
 it.each([{exclusive_customer_id:null},{exclusive_customer_id:''},{affiliation_type:'internal'},{roles:{...member.roles,name:'gestor'}}])('preserves shared/unassigned/internal scope %j',async patch=>{await expect(fixture('/api/v1/documents','GET',patch).run()).resolves.toBe(true);});
 it('does not infer client by a display name',()=>{expect(restrictClientPortalRequest({...member,exclusive_customer_id:null},member.roles,'/anything','POST')).toBe(false);});
});
