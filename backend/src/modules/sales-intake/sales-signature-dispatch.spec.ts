import {SalesSignatureAdapter,SIGNATURE_STEPS,SignatureClaim,signatureOperation,signatureOperationResult} from './sales-signature.adapter';
import {SalesSignatureDispatchService} from './sales-signature-dispatch.service';
import {signaturePdfHash,CLICKSIGN_SANDBOX_API} from './sales-signature-protocol';
const id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',external='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const pdf=Buffer.from('%PDF-1.7\n'+'.'.repeat(200)+'\n%%EOF');
const claim=(ordinal=1):SignatureClaim=>({id,lease:id,ordinal,step:SIGNATURE_STEPS[ordinal-1],source:{draftSha256:signaturePdfHash(pdf),pdfHex:pdf.toString('hex'),parties:{supplier:{signatory:'Test Supplier',email:'supplier@example.com'},customer:{signatory:'Test Customer',email:'customer@example.com'}}},dependencies:{envelope:external,document:external,supplier:external,customer:external}});
const config=(extra={})=>({get:(k:string)=>({SALES_SIGNATURE_PREPARATION_ENABLED:'true',SALES_SIGNATURE_COMMANDS_ENABLED:'true',SALES_SIGNATURE_CALLS_ENABLED:'true',SALES_CLICKSIGN_BASE_URL:CLICKSIGN_SANDBOX_API,SALES_CLICKSIGN_SANDBOX_TOKEN:'test-token-not-a-real-secret',...extra})[k]});
describe('Clicksign creation protocol, mocked only',()=>{
 const original=global.fetch;afterEach(()=>{global.fetch=original;});
 it.each(SIGNATURE_STEPS.map((s,i)=>[s,i+1] as const))('validates step %s without activation/notifications',async(s,n)=>{
  const c=claim(n),op=signatureOperation(c),data:any={...op.body.data,id:external};
  if(n===1)data.attributes={...data.attributes,status:'draft'};
  global.fetch=jest.fn().mockResolvedValue(new Response(JSON.stringify({data}),{status:201}));
  expect(await new SalesSignatureAdapter(config() as any).dispatch(c)).toEqual({externalId:external,type:data.type});
  expect(global.fetch).toHaveBeenCalledTimes(1);const [url,opts]=(global.fetch as jest.Mock).mock.calls[0];
  expect(url).toBe(CLICKSIGN_SANDBOX_API+op.path);expect(url).not.toContain('notifications');expect(opts.method).toBe('POST');expect(opts.redirect).toBe('error');
 });
 it.each([{SALES_SIGNATURE_CALLS_ENABLED:'false'},{SALES_SIGNATURE_COMMANDS_ENABLED:'false'},{SALES_SIGNATURE_PREPARATION_ENABLED:'false'},{SALES_CLICKSIGN_BASE_URL:'https://app.clicksign.com/api/v3'},{SALES_CLICKSIGN_SANDBOX_TOKEN:''}])('blocks unsafe configuration %j',async extra=>{
  global.fetch=jest.fn();await expect(new SalesSignatureAdapter(config(extra) as any).dispatch(claim())).rejects.toThrow();expect(global.fetch).not.toHaveBeenCalled();
 });
 it.each([new Response('{}',{status:500}),new Response('invalid',{status:201}),new Response('x'.repeat(131073),{status:201})])('never retries unexpected provider response',async response=>{global.fetch=jest.fn().mockResolvedValue(response);await expect(new SalesSignatureAdapter(config() as any).dispatch(claim())).rejects.toThrow('incerto');expect(global.fetch).toHaveBeenCalledTimes(1);});
 it('blocks mismatched PDF and relationships',()=>{
  const c=claim(2);c.source.draftSha256='f'.repeat(64);expect(()=>signatureOperation(c)).toThrow();
  const req=claim(5),data:any={...signatureOperation(req).body.data,id:external};data.relationships={document:{data:{id,type:'documents'}},signer:{data:{id:external,type:'signers'}}};expect(()=>signatureOperationResult(req,{data})).toThrow();
 });
});
describe('Clicksign durable dispatch ordering',()=>{
 let rpc:jest.Mock,adapter:any,service:SalesSignatureDispatchService;
 const body={id,expectedOrdinal:1,justification:'Controlled sandbox creation fixture.'};
 beforeEach(()=>{rpc=jest.fn().mockImplementation(async(_name,args)=>args.p_action==='claim'?claim():{state:'VERIFIED'});adapter={assertEnabled:jest.fn(),dispatch:jest.fn().mockResolvedValue({externalId:external,type:'envelopes'})};service=new SalesSignatureDispatchService({rpc} as any,config() as any,adapter);});
 it('persists claim and reservation before one POST, then result',async()=>{await service.next(id,body);expect(rpc.mock.calls.map(c=>c[1].p_action)).toEqual(['claim','reserve','finish']);expect(rpc.mock.invocationCallOrder[1]).toBeLessThan(adapter.dispatch.mock.invocationCallOrder[0]);expect(adapter.dispatch).toHaveBeenCalledTimes(1);expect(rpc.mock.calls.every(c=>c[1].p_actor===id)).toBe(true);});
 it.each(['claim','reserve'])('does not POST if %s transaction is uncertain',async action=>{rpc.mockImplementation(async(_n,a)=>{if(a.p_action===action)throw Error('database');return claim();});await expect(service.next(id,body)).rejects.toThrow();expect(adapter.dispatch).not.toHaveBeenCalled();});
 it('persists unknown after timeout without resend',async()=>{adapter.dispatch.mockRejectedValue(Error('timeout'));await expect(service.next(id,body)).rejects.toThrow('incerta');expect(rpc.mock.calls.at(-1)[1].p_body.result).toBeNull();expect(adapter.dispatch).toHaveBeenCalledTimes(1);});
 it('leaves reservation if finish fails',async()=>{rpc.mockImplementation(async(_n,a)=>{if(a.p_action==='finish')throw Error('database');return claim();});await expect(service.next(id,body)).rejects.toThrow();expect(adapter.dispatch).toHaveBeenCalledTimes(1);expect(rpc.mock.calls.map(c=>c[1].p_action)).toEqual(['claim','reserve','finish']);});
 it('aborts invalid source before reserving',async()=>{rpc.mockResolvedValue({...claim(),step:'invalid'});await expect(service.next(id,body)).rejects.toThrow('incompleta');expect(rpc.mock.calls.map(c=>c[1].p_action)).toEqual(['claim','abort']);expect(adapter.dispatch).not.toHaveBeenCalled();});
 it('checks transport configuration before persisting anything',async()=>{adapter.assertEnabled.mockImplementation(()=>{throw Error('off');});await expect(service.next(id,body)).rejects.toThrow();expect(rpc).not.toHaveBeenCalled();});
});
