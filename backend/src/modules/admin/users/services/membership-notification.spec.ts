import {sendMembershipNotification} from './membership-notification';
import {UsersService} from './users.service';
describe('membership notification',()=>{
 const input={membershipId:'member-a',email:'person@example.test',organizationName:'Empresa <Teste>',roleName:'operacional',affiliationType:'external'};
 const originalFetch=global.fetch; const env={...process.env};
 beforeEach(()=>{process.env.RESEND_API_KEY='test-key';process.env.FRONTEND_URL='https://app.example.test';global.fetch=jest.fn().mockResolvedValue({ok:true,json:async()=>({id:'mail-id'})});});
 afterEach(()=>{global.fetch=originalFetch;process.env={...env};jest.restoreAllMocks();});
 it('uses existing login, tenant name, role, affiliation and idempotent membership key',async()=>{
  expect(await sendMembershipNotification(input)).toBe('accepted');
  const [url,options]=(global.fetch as jest.Mock).mock.calls[0];const body=JSON.parse(options.body);
  expect(url).toBe('https://api.resend.com/emails');expect(body.to).toEqual([input.email]);
  expect(body.text).toContain(input.organizationName);expect(body.text).toContain('Operador');expect(body.text).toContain('Externo / consultor');expect(body.text).toContain('https://app.example.test/auth/login');
  expect(options.headers['Idempotency-Key']).toBe('organization-membership/member-a');expect(body.html).toBeUndefined();
 });
 it('sends the reactivation subject and organization',async()=>{await sendMembershipNotification({...input,event:'reactivated'});const body=JSON.parse((global.fetch as jest.Mock).mock.calls[0][1].body);expect(body.subject).toContain('reativado');expect(body.text).toContain('foi reativado');expect(body.text).toContain(input.organizationName);});
 it('does not send without configuration',async()=>{delete process.env.RESEND_API_KEY;expect(await sendMembershipNotification(input)).toBe('unavailable');expect(global.fetch).not.toHaveBeenCalled();});
 it('rejects insecure frontend URLs',async()=>{process.env.FRONTEND_URL='http://example.test';expect(await sendMembershipNotification(input)).toBe('unavailable');expect(global.fetch).not.toHaveBeenCalled();});
 it('contains provider rejection',async()=>{(global.fetch as jest.Mock).mockResolvedValue({ok:false});expect(await sendMembershipNotification(input)).toBe('failed');});
 it('contains network failure',async()=>{(global.fetch as jest.Mock).mockRejectedValue(new Error('network'));expect(await sendMembershipNotification(input)).toBe('failed');});
 it('requires provider message id',async()=>{(global.fetch as jest.Mock).mockResolvedValue({ok:true,json:async()=>({})});expect(await sendMembershipNotification(input)).toBe('failed');});
 it('does not notify inactive membership',async()=>{const service=new UsersService({} as any,{} as any);jest.spyOn(service,'findOne').mockResolvedValue({membershipStatus:'inactive'} as any);await expect(service.notifyExistingMember('user',{organizationId:'a',actorPermissions:[],platformOperation:false})).rejects.toThrow('ativo');expect(global.fetch).not.toHaveBeenCalled();});
 it('enforces assignable-role authorization',async()=>{const service=new UsersService({} as any,{} as any);jest.spyOn(service,'findOne').mockResolvedValue({membershipStatus:'active',role:{id:'r'}} as any);jest.spyOn(service,'assertAssignable').mockRejectedValue(new Error('forbidden'));await expect(service.notifyExistingMember('user',{organizationId:'a',actorPermissions:[],platformOperation:false})).rejects.toThrow('forbidden');expect(global.fetch).not.toHaveBeenCalled();});
 it('contains organization lookup failure without compensating membership',async()=>{const client={from:()=>{throw new Error('database')}};const service=new UsersService({getClient:()=>client} as any,{} as any);expect(await (service as any).notifyMembership('m','a@example.test','a','gestor','internal')).toBe('failed');expect(global.fetch).not.toHaveBeenCalled();});
});
