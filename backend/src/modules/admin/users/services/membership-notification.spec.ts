import {sendMembershipNotification} from './membership-notification';
import {UsersService} from './users.service';
describe('membership notification',()=>{
 const input={membershipId:'member-a',email:'person@example.test',organizationName:'Empresa <Teste>',roleName:'operacional',affiliationType:'external'};
 const originalFetch=global.fetch; const env={...process.env};
 beforeEach(()=>{process.env.RESEND_API_KEY='test-key';process.env.FRONTEND_URL='https://app.example.test';global.fetch=jest.fn().mockResolvedValue({ok:true,json:async()=>({id:'mail-id'})});});
 afterEach(()=>{global.fetch=originalFetch;process.env={...env};jest.restoreAllMocks();});
 it('confirms each approved scope change with its own idempotency key and escaped unit names',async()=>{await sendMembershipNotification({...input,roleName:'consulta',customerName:'Client',unitNames:['Unit <A>'],scopeEventId:'approved-request',scopeActive:true});const options=(global.fetch as jest.Mock).mock.calls[0][1],body=JSON.parse(options.body);expect(options.headers['Idempotency-Key']).toBe('organization-portal-scope/approved-request');expect(body.subject).toContain('Portal');expect(body.text).toContain('Unit <A>');expect(body.html).toContain('Unit &lt;A&gt;');expect(body.html).not.toContain('Unit <A>');expect(body.html).toContain('senha atual permanece válida');});
 it('uses existing login, tenant name, role, affiliation and idempotent membership key',async()=>{
  expect(await sendMembershipNotification(input)).toBe('accepted');
  const [url,options]=(global.fetch as jest.Mock).mock.calls[0];const body=JSON.parse(options.body);
  expect(url).toBe('https://api.resend.com/emails');expect(body.to).toEqual([input.email]);
  expect(body.text).toContain(input.organizationName);expect(body.text).toContain('Operador');expect(body.text).toContain('Externo / consultor');expect(body.text).toContain('https://app.example.test/auth/login');
  expect(options.headers['Idempotency-Key']).toBe('organization-membership/member-a');expect(body.html).toContain('Powered by Expert Energy');expect(body.html).toContain('Empresa &lt;Teste&gt;');expect(body.html).not.toContain('Empresa <Teste>');expect(body.html).toContain('https://app.example.test/auth/login');
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
 it('welcomes Portal members with company and use instructions while retaining the existing password',async()=>{
   await sendMembershipNotification({...input,roleName:'consulta',customerName:'Cliente <Privado>'});
   const body=JSON.parse((global.fetch as jest.Mock).mock.calls[0][1].body);
   expect(body.text).toContain('Portal do cliente');expect(body.text).toContain('Cliente <Privado>');expect(body.text).toContain('envie novos documentos');expect(body.text).toContain('senha atuais');
   expect(body.html).toContain('Cliente &lt;Privado&gt;');expect(body.html).not.toContain('Cliente <Privado>');expect(body.html).not.toContain('Criar minha senha');
 });
 it('welcomes Backoffice members with role and designation guidance',async()=>{
   await sendMembershipNotification(input);const body=JSON.parse((global.fetch as jest.Mock).mock.calls[0][1].body);
   expect(body.text).toContain('Backoffice');expect(body.text).toContain('designações e permissões');expect(body.html).toContain('Operador');expect(body.html).not.toContain('Empresa:');
 });
 it('does not treat an external consultant without an exclusive company as a Portal member',async()=>{
   await sendMembershipNotification({...input,roleName:'consulta'});const body=JSON.parse((global.fetch as jest.Mock).mock.calls[0][1].body);expect(body.text).toContain('Ambiente: Backoffice');
 });
 it('resolves notification company through the active membership in the same organization',async()=>{
   const queries:any[]=[];
   const rows:any={organization_members:[{user_id:'u',organization_id:'org',status:'active',roles:{name:'consulta'},affiliation_type:'external',exclusive_customer_id:'company'}],organizations:[{id:'org',name:'Org'}],customers:[{id:'company',organization_id:'org',company_name:'Scoped company'}]};
   const client={from:(table:string)=>{const q:any={select:()=>q,eq:(k:string,v:string)=>{queries.push([table,k,v]);return q;},then:(done:any)=>Promise.resolve({data:rows[table],error:null}).then(done)};return q;}};
   const service=new UsersService({getClient:()=>client} as any,{} as any);
   expect(await (service as any).notifyMembership('event','p@example.test','org','consulta','external',undefined,'u')).toBe('accepted');
   expect(queries).toContainEqual(['customers','organization_id','org']);expect(queries).toContainEqual(['organization_members','user_id','u']);
   expect(JSON.parse((global.fetch as jest.Mock).mock.calls[0][1].body).text).toContain('Scoped company');
   rows.customers[0].organization_id='other';(global.fetch as jest.Mock).mockClear();
   expect(await (service as any).notifyMembership('event','p@example.test','org','consulta','external',undefined,'u')).toBe('failed');expect(global.fetch).not.toHaveBeenCalled();
 });

});
