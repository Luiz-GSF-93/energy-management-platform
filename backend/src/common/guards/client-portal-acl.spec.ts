import { restrictClientPortalRequest } from './client-portal-access';
describe('external client ACL route boundary',()=>{
 const member={affiliation_type:'external',exclusive_customer_id:'c1'},role={name:'consulta'};
 it('permits only the minimal GET collection route and leaves customer binding to its service/RPC',()=>{
  expect(restrictClientPortalRequest(member,role,'/api/v1/portal/acl-admissions','GET')).toBe(false);
  expect(restrictClientPortalRequest(member,role,'/api/v1/portal/acl-admissions/','GET')).toBe(false);
 });
 it('keeps writes, internal admissions and detail routes blocked',()=>{
  for(const method of ['POST','PUT','PATCH','DELETE'])expect(restrictClientPortalRequest(member,role,'/api/v1/portal/acl-admissions',method)).toBe(true);
  for(const path of ['/api/v1/acl-admissions','/api/v1/acl-admissions/access','/api/v1/portal/acl-admissions/private','/api/v1/portal/acl-admissions-copy'])expect(restrictClientPortalRequest(member,role,path,'GET')).toBe(true);
 });
});
