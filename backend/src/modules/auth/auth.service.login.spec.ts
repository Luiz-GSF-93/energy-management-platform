import {AuthService} from './auth.service';
import {ServiceUnavailableException,UnauthorizedException} from '@nestjs/common';
describe('AuthService login provider availability',()=>{
 function setup(result:unknown){const signInWithPassword=jest.fn().mockResolvedValue(result);const service=new AuthService({createAuthClient:()=>({auth:{signInWithPassword}})} as any,{} as any,{} as any);jest.spyOn((service as any).logger,'warn').mockImplementation(()=>{});return {service,signInWithPassword};}
 const credentials={email:'test@example.invalid',password:'test-password'};
 afterEach(()=>jest.restoreAllMocks());
 it('keeps invalid credentials unauthorized',async()=>{const {service}=setup({data:null,error:{status:400,code:'invalid_credentials'}});await expect(service.login(credentials)).rejects.toBeInstanceOf(UnauthorizedException);});
 it.each([0,401,403,429,500,502,503])('does not mislabel provider status %s as a password error',async status=>{const {service,signInWithPassword}=setup({data:null,error:{status,message:'secret provider details'}});await expect(service.login(credentials)).rejects.toBeInstanceOf(ServiceUnavailableException);expect(signInWithPassword).toHaveBeenCalledTimes(1);expect((service as any).logger.warn).toHaveBeenCalledWith('AUTH_PROVIDER_UNAVAILABLE');});
 it('handles network rejection without retry or sensitive output',async()=>{const {service,signInWithPassword}=setup(null);signInWithPassword.mockRejectedValue(new Error('secret'));await expect(service.login(credentials)).rejects.toThrow('Serviço de acesso temporariamente indisponível');expect(signInWithPassword).toHaveBeenCalledTimes(1);});
 it('fails closed on incomplete sessions',async()=>{const {service}=setup({data:{user:{id:'actor'}},error:null});await expect(service.login(credentials)).rejects.toBeInstanceOf(ServiceUnavailableException);});
 it('preserves successful session response',async()=>{const {service}=setup({data:{session:{access_token:'test-access',refresh_token:'test-refresh'},user:{id:'actor',email:credentials.email,user_metadata:{name:'Test'}}},error:null});await expect(service.login(credentials)).resolves.toEqual({access_token:'test-access',refresh_token:'test-refresh',user:{id:'actor',email:credentials.email,name:'Test'}});});
});
