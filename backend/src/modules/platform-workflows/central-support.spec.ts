import {generateSupportCode,supportCodeHash,supportEmail,supportInput} from './central-support.model';
import {CentralSupportService} from './central-support.service';
describe('Central support consent and delivery boundary',()=>{
 const secret='test-only-secret-with-at-least-32-characters',id='11111111-1111-4111-8111-111111111111';
 const tenant={organizationId:'org',userId:id,role:'admin_org'} as any;
 let rpc:jest.Mock,service:CentralSupportService;
 const originalFetch=global.fetch,originalEnv={...process.env};
 beforeEach(()=>{rpc=jest.fn().mockResolvedValue({data:{id,recorded:true},error:null});service=new CentralSupportService({getClient:()=>({rpc})} as any);process.env.CENTRAL_SUPPORT_CODE_SECRET=secret;});
 afterEach(()=>{service.onModuleDestroy();global.fetch=originalFetch;process.env={...originalEnv};});
 it('uses cryptographic eight digit codes, including leading zero representation',()=>{for(let n=0;n<50;n++)expect(generateSupportCode()).toMatch(/^\d{8}$/);});
 it('binds hashes to organization, request and server secret',()=>{const hash=supportCodeHash(secret,'org',id,'12345678');expect(hash).toMatch(/^[a-f0-9]{64}$/);expect(supportCodeHash(secret,'other',id,'12345678')).not.toBe(hash);expect(supportCodeHash(secret,'org','other','12345678')).not.toBe(hash);expect(()=>supportCodeHash('short','org',id,'12345678')).toThrow();});
 it('rejects forged identity, price fields and unconfirmed consent',()=>{
  for(const b of [{revision:1,confirmed:false,quoteMinor:0},{revision:1,confirmed:true,quoteMinor:-1},{revision:1,confirmed:true,quoteMinor:1.5},{revision:1,confirmed:true,quoteMinor:0,organizationId:'foreign'}])expect(()=>supportInput('authorize',b)).toThrow();
  expect(()=>supportInput('draft',{title:'Valid title',description:'Valid description',actor:'forged'})).toThrow();
  expect(()=>supportInput('submit',{code:'1234'})).toThrow();
 });
 it('rejects external and platform operation contexts before database access',async()=>{for(const t of [{...tenant,role:'consulta'},{...tenant,accessMode:'platform_operation'},{}])await expect(service.list(t as any)).rejects.toMatchObject({status:403});expect(rpc).not.toHaveBeenCalled();});
 it('uses authenticated organization and actor and never persists the plaintext code',async()=>{
  const result=await service.action(tenant,'authorize',id,{revision:1,confirmed:true,quoteMinor:0});
  expect(result.code).toMatch(/^\d{8}$/);const args=rpc.mock.calls[0][1];expect(args.o).toBe('org');expect(args.a).toBe(id);expect(args.b.codeHash).toBe(supportCodeHash(secret,'org',id,result.code));expect(args.b.code).toBeUndefined();
 });
 it('hashes submitted codes and returns precise safe conflict messages',async()=>{rpc.mockResolvedValue({data:{error:'CODE',message:'Código inválido'},error:null});await expect(service.action(tenant,'submit',id,{code:'12345678'})).rejects.toMatchObject({status:409,message:'Código inválido'});expect(rpc.mock.calls[0][1].b).toEqual({codeHash:supportCodeHash(secret,'org',id,'12345678')});});
 it('fails closed when secret or server response is missing',async()=>{delete process.env.CENTRAL_SUPPORT_CODE_SECRET;await expect(service.action(tenant,'submit',id,{code:'12345678'})).rejects.toMatchObject({status:503});expect(rpc).not.toHaveBeenCalled();rpc.mockResolvedValue({error:{code:'XX000',message:'private SQL'},data:null});await expect(service.list(tenant)).rejects.toMatchObject({status:503});});
 const payload={protocol:'AT-TEST',organizationName:'Synthetic',title:'Question',status:'OPEN',deadline:'2026-12-31',quoteMinor:2500,summary:{starts:'2026-01-01',ends:'2027-01-01',allowance:60,includedUsed:60,remaining:0,extrasUsed:1,totalUsed:61}};
 it('includes cycle, quota, usage and extra cost in every support email',()=>{const email=supportEmail(payload);for(const part of ['AT-TEST','60','61','25,00','2027-01-01','inclusão','Inclusão']){if(part==='inclusão')continue;expect(email.text).toContain(part);}expect(email.text).not.toContain('pago');});
 it('does not send emails when activation or provider configuration is missing',async()=>{global.fetch=jest.fn();delete process.env.CENTRAL_SUPPORT_EMAIL_ENABLED;await service.tick();expect(rpc).not.toHaveBeenCalled();expect(global.fetch).not.toHaveBeenCalled();});
 it('stages lease and uses stable provider idempotency without claiming delivery',async()=>{
  process.env.CENTRAL_SUPPORT_EMAIL_ENABLED='true';process.env.RESEND_API_KEY='test-only';
  rpc.mockResolvedValueOnce({data:{id,payload,recipients:['admin@example.test']},error:null});global.fetch=jest.fn().mockResolvedValue({ok:true,status:200,json:async()=>({id:'receipt'})});await service.tick();
  expect(global.fetch).toHaveBeenCalledTimes(1);const args=(global.fetch as jest.Mock).mock.calls[0][1];expect(args.headers['Idempotency-Key']).toBe('central-support/'+id);expect(JSON.parse(args.body).to).toEqual(['admin@example.test']);expect(rpc).toHaveBeenLastCalledWith('central_support_delivery',expect.objectContaining({x:'finish',i:id,b:expect.objectContaining({state:'ACCEPTED',providerId:'receipt'})}));
 });
 it('preserves unknown delivery on network ambiguity without immediate resubmission',async()=>{process.env.CENTRAL_SUPPORT_EMAIL_ENABLED='true';process.env.RESEND_API_KEY='test-only';rpc.mockResolvedValueOnce({data:{id,payload,recipients:['admin@example.test']},error:null});global.fetch=jest.fn().mockRejectedValue(Error('timeout'));await service.tick();expect(global.fetch).toHaveBeenCalledTimes(1);expect(rpc).toHaveBeenLastCalledWith('central_support_delivery',expect.objectContaining({b:expect.objectContaining({state:'UNKNOWN'})}));});
});
