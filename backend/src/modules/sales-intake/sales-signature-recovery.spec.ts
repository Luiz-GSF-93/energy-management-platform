import {SalesSignatureRecoveryService} from './sales-signature-recovery.service';
import {SignatureClaim,signatureOperation} from './sales-signature.adapter';
import {CLICKSIGN_SANDBOX_API} from './sales-signature-protocol';
const id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',external='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const config=(extra={})=>({get:(key:string)=>({SALES_SIGNATURE_PREPARATION_ENABLED:'true',SALES_SIGNATURE_COMMANDS_ENABLED:'true',SALES_SIGNATURE_RECOVERY_ENABLED:'true',SALES_SIGNATURE_RECOVERY_CALLS_ENABLED:'true',SALES_CLICKSIGN_BASE_URL:CLICKSIGN_SANDBOX_API,SALES_CLICKSIGN_SANDBOX_TOKEN:'test-fixture-token-only',SALES_SIGNATURE_CALLS_ENABLED:'false',...extra})[key]});
const source={draftSha256:'a'.repeat(64),parties:{supplier:{signatory:'Test Supplier',email:'supplier@example.com'},customer:{signatory:'Test Customer',email:'customer@example.com'}}};
const body={id,lease:id,requestId:id,candidateId:external,justification:'Read-only reconciliation of sandbox fixture.'};
const claim=(ordinal=1):SignatureClaim&{candidateId:string}=>({id,lease:id,ordinal,step:['ENVELOPE','DOCUMENT','SUPPLIER','CUSTOMER','QUAL_SUPPLIER','AUTH_SUPPLIER','QUAL_CUSTOMER','AUTH_CUSTOMER'][ordinal-1] as any,source,dependencies:{envelope:id,document:id,supplier:id,customer:id},candidateId:external});
describe('Clicksign strict GET recovery — mocked API only',()=>{
 let rpc:jest.Mock,service:SalesSignatureRecoveryService;const original=global.fetch;
 beforeEach(()=>{rpc=jest.fn().mockImplementation(async(_n,a)=>a.p_action==='begin'?claim():{state:'RECOVERED'});service=new SalesSignatureRecoveryService({rpc} as any,config() as any);global.fetch=jest.fn();});
 afterEach(()=>{global.fetch=original;});
 const response=(c:SignatureClaim,resourceId=external)=>{const data:any={...signatureOperation(c).body.data,id:resourceId};if(c.ordinal===1)data.attributes={...data.attributes,status:'draft'};return new Response(JSON.stringify({data}),{status:200});};
 it('GETs the candidate and persists only sanitized proof; creation remains off',async()=>{
  (global.fetch as jest.Mock).mockResolvedValue(response(claim()));await service.check(id,body);
  expect((global.fetch as jest.Mock).mock.calls[0][0]).toBe(CLICKSIGN_SANDBOX_API+'/envelopes/'+external);
  expect((global.fetch as jest.Mock).mock.calls[0][1].method).toBe('GET');expect((global.fetch as jest.Mock).mock.calls[0][1].redirect).toBe('error');
  expect(rpc.mock.calls.map(c=>c[1].p_action)).toEqual(['begin','complete']);expect(rpc.mock.calls[1][1].p_body.result).toEqual({externalId:external,type:'envelopes'});
 });
 it.each([3,4,5,6,7,8])('binds child step %s to the preserved draft envelope',async ordinal=>{
  const c=claim(ordinal);rpc.mockImplementation(async(_n,a)=>a.p_action==='begin'?c:{state:'RECOVERED'});
  (global.fetch as jest.Mock).mockResolvedValueOnce(response(claim(),id)).mockResolvedValueOnce(response(c));
  await service.check(id,body);expect((global.fetch as jest.Mock).mock.calls).toHaveLength(2);expect((global.fetch as jest.Mock).mock.calls.every(c=>c[1].method==='GET')).toBe(true);
  expect((global.fetch as jest.Mock).mock.calls[1][0]).toBe(CLICKSIGN_SANDBOX_API+signatureOperation(c).path+'/'+external);
 });
 it.each([{SALES_SIGNATURE_RECOVERY_ENABLED:'false'},{SALES_SIGNATURE_RECOVERY_CALLS_ENABLED:'false'},{SALES_SIGNATURE_COMMANDS_ENABLED:'false'},{SALES_CLICKSIGN_BASE_URL:'https://app.clicksign.com/api/v3'},{SALES_CLICKSIGN_SANDBOX_TOKEN:''}])('disabled/unsafe configuration makes no RPC/GET %j',async extra=>{service=new SalesSignatureRecoveryService({rpc} as any,config(extra) as any);await expect(service.check(id,body)).rejects.toThrow();expect(rpc).not.toHaveBeenCalled();expect(global.fetch).not.toHaveBeenCalled();});
 it('does not repeat a GET for the same pending request',async()=>{rpc.mockResolvedValue({replayed:true,state:'PENDING'});expect(await service.check(id,body)).toEqual({replayed:true,state:'PENDING'});expect(global.fetch).not.toHaveBeenCalled();expect(rpc).toHaveBeenCalledTimes(1);});
 it('does not accept document filename as PDF proof',async()=>{rpc.mockResolvedValue(claim(2));await expect(service.check(id,body)).rejects.toThrow('incompleta');expect(global.fetch).not.toHaveBeenCalled();expect(rpc.mock.calls.at(-1)[1].p_body.result).toBeNull();});
 it.each([new Response('{}',{status:404}),new Response('not json',{status:200}),new Response('x'.repeat(131073),{status:200})])('incomplete response preserves block without re-POST',async response=>{(global.fetch as jest.Mock).mockResolvedValue(response);await expect(service.check(id,body)).rejects.toThrow('bloqueio');expect(global.fetch).toHaveBeenCalledTimes(1);expect(rpc.mock.calls.at(-1)[1].p_body.result).toBeNull();});
 it('rejects running or foreign parent before consulting child',async()=>{rpc.mockImplementation(async(_n,a)=>a.p_action==='begin'?claim(3):{});(global.fetch as jest.Mock).mockResolvedValue(new Response(JSON.stringify({data:{id,type:'envelopes',attributes:{name:'Foreign envelope',status:'running'}}}),{status:200}));await expect(service.check(id,body)).rejects.toThrow();expect(global.fetch).toHaveBeenCalledTimes(1);});
 it('checks candidate ID independently of matching metadata',async()=>{(global.fetch as jest.Mock).mockResolvedValue(response(claim(),id));await expect(service.check(id,body)).rejects.toThrow();expect(rpc.mock.calls.at(-1)[1].p_body.result).toBeNull();});
 it('does not query when durable begin fails',async()=>{rpc.mockRejectedValue(Error('db'));await expect(service.check(id,body)).rejects.toThrow();expect(global.fetch).not.toHaveBeenCalled();});
 it('does not repeat a GET when result persistence fails',async()=>{rpc.mockImplementation(async(_n,a)=>{if(a.p_action==='complete')throw Error('db');return claim();});(global.fetch as jest.Mock).mockResolvedValue(response(claim()));await expect(service.check(id,body)).rejects.toThrow();expect(global.fetch).toHaveBeenCalledTimes(1);});
 it('rejects arbitrary URL and spoofed actor fields',async()=>{await expect(service.check(id,{...body,candidateId:'https://internal/'})).rejects.toThrow();await expect(service.check(id,{...body,actorId:id})).rejects.toThrow();expect(rpc).not.toHaveBeenCalled();expect(global.fetch).not.toHaveBeenCalled();});
 it.each([{page:'-1'},{page:'1001'},{page:[]},{actorId:id}])('rejects invalid pagination %j',async q=>{await expect(service.read(id,id,q)).rejects.toThrow();expect(rpc).not.toHaveBeenCalled();});
});
