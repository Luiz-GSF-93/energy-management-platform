import {ConfigService} from '@nestjs/config';
import {SalesEvidenceAdapter} from './sales-evidence.adapter';
import {SANDBOX_URL} from './sales-asaas.adapter';
const source={paymentId:'pay_fixture',customer:'cus_fixture',reference:'00000000-0000-4000-8000-000000000001',grossCents:260000};
const raw={id:source.paymentId,customer:source.customer,externalReference:source.reference,value:2600,netValue:2599.01,status:'RECEIVED'};
const flags={SALES_EVIDENCE_ENABLED:'true',SALES_EVIDENCE_CALLS_ENABLED:'true',SALES_ASAAS_SANDBOX_ENABLED:'true',SALES_ASAAS_BASE_URL:SANDBOX_URL,SALES_ASAAS_SANDBOX_API_KEY:'fixture-never-real-key-123'};
const config=(change={})=>({get:(k:string)=>({...flags,...change} as Record<string,string>)[k]}) as ConfigService;
const refund={id:'ref_fixture',payment:source.paymentId,status:'DONE',value:10,dateCreated:'2030-01-20 12:30:00',transactionReceiptUrl:'https://secret/',description:'secret'};
const invoice={id:'inv_fixture',payment:source.paymentId,customer:source.customer,value:2600,effectiveDate:'2030-01-20',status:'AUTHORIZED'};
const response=(x:any)=>new Response(JSON.stringify(x));
const original=global.fetch;afterEach(()=>{global.fetch=original;jest.restoreAllMocks();});
function setup(refunds:any=[],invoices:any={data:[],hasMore:false},after:any=raw){
 let paymentReads=0;
 global.fetch=jest.fn(async(url:string)=>{
  if(url.includes('/refunds?')){if(refunds instanceof Error)throw refunds;return response(typeof refunds==='function'?refunds(url):refunds);}
  if(url.includes('/invoices?')){if(invoices instanceof Error)throw invoices;return response(typeof invoices==='function'?invoices(url):invoices);}
  paymentReads++;if(paymentReads>1&&after instanceof Error)throw after;
  return response(paymentReads>1?after:raw);
 }) as any;
 return new SalesEvidenceAdapter(config());
}
describe('bounded complete refunds evidence',()=>{
 for(const flag of ['SALES_EVIDENCE_ENABLED','SALES_EVIDENCE_CALLS_ENABLED','SALES_ASAAS_SANDBOX_ENABLED'])it('blocks '+flag+' before network',async()=>{global.fetch=jest.fn();await expect(new SalesEvidenceAdapter(config({[flag]:'false'})).evidence(source)).rejects.toThrow();expect(global.fetch).not.toHaveBeenCalled();});
 it('blocks production before network',async()=>{global.fetch=jest.fn();await expect(new SalesEvidenceAdapter(config({SALES_ASAAS_BASE_URL:'https://api.asaas.com/v3'})).evidence(source)).rejects.toThrow();expect(global.fetch).not.toHaveBeenCalled();});
 it('proves empty history using endpoint, not missing payment field',async()=>{const r=await setup().evidence(source);expect(r.refundsComplete).toBe(true);expect(r.refunds).toEqual([]);expect(r.invoicesComplete).toBe(true);expect(global.fetch).toHaveBeenCalledTimes(4);for(const [url,opts] of (global.fetch as jest.Mock).mock.calls){expect(url).toMatch(/^https:\/\/api-sandbox\.asaas\.com\/v3\//);expect(opts).toMatchObject({method:'GET',redirect:'error'});} });
 it('uses strict invoice payment filter',async()=>{const r=await setup([],{data:[invoice],hasMore:false}).evidence(source);expect(r.invoices).toHaveLength(1);expect((global.fetch as jest.Mock).mock.calls[2][0]).toContain('payment=pay_fixture');});
 it('sanitizes all statuses without identifiers or receipt URLs in persisted shape',async()=>{const r=await setup(['DONE','PENDING','CANCELLED'].map((status,i)=>({...refund,id:'ref_'+i,status}))).evidence(source);expect(r.refundsComplete).toBe(true);expect(r.refunds).toHaveLength(3);expect(JSON.stringify(r)).not.toMatch(/secret|ref_0|transactionReceipt/);});
 it('proves paginated total',async()=>{const r=await setup((url:string)=>new URL(url).searchParams.get('offset')==='0'?{data:Array.from({length:25},(_,i)=>({...refund,id:'ref_'+i,value:1})),hasMore:true,totalCount:26}:{data:[{...refund,id:'ref_last',value:1}],hasMore:false,totalCount:26}).evidence(source);expect(r.refundsComplete).toBe(true);expect(r.refunds).toHaveLength(26);expect(global.fetch).toHaveBeenCalledTimes(5);});
 it.each([
  [refund,refund], [{...refund,payment:'pay_other'}], [{...refund,status:'UNKNOWN'}], [{...refund,value:0.001}], [{...refund,dateCreated:'2030-02-31'}], [{...refund,id:undefined}], [{...refund,value:2601}],
  {data:[],hasMore:false,totalCount:1}, {data:[],hasMore:false}, {data:[],hasMore:true,totalCount:1}, {refunds:[]},
  new Error('secret'), Array.from({length:101},(_,i)=>({...refund,id:'ref_'+i,value:1}))
 ])('incomplete history never proves zero %p',async(x)=>{const r=await setup(x).evidence(source);expect(r.refundsComplete).toBe(false);expect(r.refunds).toEqual([]);expect(r.payment.grossCents).toBe(260000);});
 it('truncation after 100 remains incomplete',async()=>{const r=await setup((url:string)=>({data:Array.from({length:25},(_,i)=>({...refund,id:'ref_'+new URL(url).searchParams.get('offset')+'_'+i,value:1})),totalCount:101,hasMore:true})).evidence(source);expect(r.refundsComplete).toBe(false);expect(r.refunds).toHaveLength(100);expect(global.fetch).toHaveBeenCalledTimes(7);});
 it('changing pagination total discards untrusted history',async()=>{const r=await setup((url:string)=>new URL(url).searchParams.get('offset')==='0'?{data:Array.from({length:25},(_,i)=>({...refund,id:'ref_'+i,value:1})),hasMore:true,totalCount:26}:{data:[{...refund,id:'ref_last'}],hasMore:false,totalCount:27}).evidence(source);expect(r.refundsComplete).toBe(false);expect(r.refunds).toEqual([]);});
 it('invoice failure preserves partial result and does not retry',async()=>{const r=await setup([],new Error('secret')).evidence(source);expect(r.invoicesComplete).toBe(false);expect(r.refundsComplete).toBe(true);expect(global.fetch).toHaveBeenCalledTimes(4);});
 it('foreign and duplicate invoices remain incomplete',async()=>{for(const rows of [[{...invoice,customer:'cus_other'}],[invoice,invoice]])expect((await setup([],{data:rows,hasMore:false}).evidence(source)).invoicesComplete).toBe(false);});
 it('at most ten GETs for both bounded histories',async()=>{const r=await setup((url:string)=>({data:Array.from({length:25},(_,i)=>({...refund,id:'ref_'+new URL(url).searchParams.get('offset')+'_'+i,value:1})),hasMore:true,totalCount:101}),(url:string)=>({data:Array.from({length:25},(_,i)=>({...invoice,id:'inv_page'+new URL(url).searchParams.get('offset')+'item'+i})),hasMore:true})).evidence(source);expect(r.invoicesComplete).toBe(false);expect(r.refundsComplete).toBe(false);expect(global.fetch).toHaveBeenCalledTimes(10);});
 it.each([{...raw,status:'REFUNDED'},{...raw,value:2601},{...raw,customer:'cus_other'},{...raw,netValue:2599},{...raw,deleted:true},new Error('secret')])('rejects changed or unverified final payment %p',async(after)=>{await expect(setup([],undefined,after).evidence(source)).rejects.toThrow('preservada');expect(global.fetch).toHaveBeenCalledTimes(4);});
 it('bounds response and redacts failure',async()=>{global.fetch=jest.fn().mockResolvedValue(new Response('x'.repeat(65537)));await expect(new SalesEvidenceAdapter(config()).evidence(source)).rejects.toThrow('preservada');expect(global.fetch).toHaveBeenCalledTimes(1);});
 it('shared deadline prevents more requests after 70 seconds',async()=>{let now=0;jest.spyOn(Date,'now').mockImplementation(()=>now);const adapter=setup();const fetch=global.fetch;global.fetch=jest.fn(async(...args:any[])=>{const r=await (fetch as any)(...args);now+=35000;return r;}) as any;await expect(adapter.evidence(source)).rejects.toThrow('preservada');expect(global.fetch).toHaveBeenCalledTimes(2);});
 it('invalid remote identifier never reaches network',async()=>{global.fetch=jest.fn();await expect(new SalesEvidenceAdapter(config()).evidence({...source,paymentId:'pay_../other'})).rejects.toThrow();expect(global.fetch).not.toHaveBeenCalled();});
});
