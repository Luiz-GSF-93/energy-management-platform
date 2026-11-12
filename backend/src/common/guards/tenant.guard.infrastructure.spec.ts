import {ServiceUnavailableException,UnauthorizedException} from '@nestjs/common';
import {TenantGuard} from './tenant.guard';
import {AuthService} from '../../modules/auth/auth.service';
describe('infrastructure outages never masquerade as an expired session',()=>{
 const reflector={getAllAndOverride:()=>false,get:()=>false} as any;
 const request=()=>({headers:{authorization:'Bearer token'},path:'/test',method:'GET'});
 const context=(r:any)=>({getHandler:()=>function test(){},getClass:()=>class Test{},switchToHttp:()=>({getRequest:()=>r})}) as any;
 it.each([{status:503,message:'provider unavailable'},{status:429,message:'rate limited'},{name:'AuthRetryableFetchError',message:'fetch failed'}])('denies the request with 503 while preserving the session on %j',async error=>{
  const r=request(),db={getClient:()=>({auth:{getUser:async()=>({data:{user:null},error})}})} as any;
  await expect(new TenantGuard(reflector,db).canActivate(context(r))).rejects.toBeInstanceOf(ServiceUnavailableException);expect((r as any).tenantContext).toBeUndefined();
  await expect(new AuthService(db,{} as any,{} as any).validateToken('token')).rejects.toBeInstanceOf(ServiceUnavailableException);
 });
 it('still rejects an invalid token with 401 and grants no tenant context',async()=>{
  const r=request(),db={getClient:()=>({auth:{getUser:async()=>({data:{user:null},error:{status:401,code:'bad_jwt',message:'invalid token'}})}})} as any;
  await expect(new TenantGuard(reflector,db).canActivate(context(r))).rejects.toBeInstanceOf(UnauthorizedException);
  await expect(new AuthService(db,{} as any,{} as any).validateToken('token')).rejects.toBeInstanceOf(UnauthorizedException);expect((r as any).tenantContext).toBeUndefined();
 });
 it('preserves authoritative denial when profile lookup has a transient timeout',async()=>{
  const r=request(),query={select:()=>query,eq:()=>query,single:async()=>({data:null,error:{code:'57014'}})},db={getClient:()=>({auth:{getUser:async()=>({data:{user:{id:'user'}},error:null})},from:()=>query})} as any;
  await expect(new TenantGuard(reflector,db).canActivate(context(r))).rejects.toBeInstanceOf(ServiceUnavailableException);expect((r as any).tenantContext).toBeUndefined();
 });
});
