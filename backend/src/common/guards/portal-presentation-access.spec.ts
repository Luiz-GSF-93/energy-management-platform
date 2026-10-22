import {restrictClientPortalRequest} from './client-portal-access';
import {portalRouteModule} from '../../modules/client-portal-licenses/portal-route-module';
import {PortalLicenseGuard} from '../../modules/client-portal-licenses/portal-license.guard';
const member={affiliation_type:'external',exclusive_customer_id:'customer'};
const role={name:'consulta'};
const root='/api/v1/portal/workspace';
const id='11111111-1111-4111-8111-111111111111';
const routes=[['GET','presentation/usage','reports'],['GET','presentation/requests','notifications'],['GET','presentation/notices','notifications'],['GET',`invoices/${id}/details`,'documents'],['POST',`invoices/${id}/payment-declaration`,'documents']];
describe('Published portal presentation passes both access boundaries',()=>{
 it('allows only the exact identity GET, leaving module alternatives to its scoped gateway',()=>{
  expect(restrictClientPortalRequest(member,role,root+'/presentation/identity','GET')).toBe(false);
  expect(portalRouteModule(root+'/presentation/identity','GET')).toBeNull();
  for(const path of ['/identity/other','/identity-copy','/identity%2Fother'])expect(restrictClientPortalRequest(member,role,root+'/presentation'+path,'GET')).toBe(true);
  for(const method of ['POST','PATCH','PUT','DELETE'])expect(restrictClientPortalRequest(member,role,root+'/presentation/identity',method)).toBe(true);
 });
 it.each(routes)('permits the scoped %s %s and enforces its licensed module',async(method,path,module)=>{
  const full=root+'/'+path,tenant={role:'consulta',organizationId:'org',userId:'actor',roleId:'role'};
  expect(restrictClientPortalRequest(member,role,full,method)).toBe(false);
  expect(portalRouteModule(full,method)).toBe(module);
  const client=jest.fn().mockResolvedValue({enabled:true});
  const guard=new PortalLicenseGuard({enabled:()=>true,client} as any);
  const ctx:any={switchToHttp:()=>({getRequest:()=>({path:full,method,tenantContext:tenant})})};
  await expect(guard.canActivate(ctx)).resolves.toBe(true);
  expect(client).toHaveBeenCalledWith(tenant,module);
  client.mockRejectedValue(new Error('module not licensed'));
  await expect(guard.canActivate(ctx)).rejects.toThrow('module not licensed');
 });
 it.each(routes)('rejects unregistered verbs, nested and malformed routes for %s %s',(method,path)=>{
  const full=root+'/'+path;
  for(const other of ['GET','POST','PUT','PATCH','DELETE'].filter(v=>v!==method))expect(restrictClientPortalRequest(member,role,full,other)).toBe(true);
  for(const suffix of ['/other','-copy','%2Fother'])expect(restrictClientPortalRequest(member,role,full+suffix,method)).toBe(true);
  if(path.startsWith('invoices/'))expect(restrictClientPortalRequest(member,role,full.replace(id,'not-a-uuid'),method)).toBe(true);
 });
 it('continues to reject backoffice records for the externally bound account',()=>{
  for(const path of ['/api/v1/documents','/api/v1/customers','/api/v1/consumer-units','/api/v1/financial-settlements'])expect(restrictClientPortalRequest(member,role,path,'GET')).toBe(true);
 });
});
