import {SalesAdjustmentCheckAdapter} from './sales-adjustment-check.adapter';
import {SANDBOX_URL} from './sales-asaas.adapter';

const source={kind:'REFUND_PAYMENT',remoteId:'pay_test',binding:{customer:'cus_test',reference:'ref_test',grossCents:260000}};
const payment={id:'pay_test',customer:'cus_test',externalReference:'ref_test',value:2600,status:'RECEIVED',deleted:false,billingType:'PIX'};
const empty={data:null,hasMore:false,totalCount:0};
const flags:Record<string,string>={SALES_ADJUSTMENT_CHECKS_ENABLED:'true',SALES_ADJUSTMENT_CHECK_CALLS_ENABLED:'true',SALES_ADJUSTMENT_COMMANDS_ENABLED:'true',SALES_ADJUSTMENT_COMMAND_CALLS_ENABLED:'true',SALES_ASAAS_SANDBOX_ENABLED:'true',SALES_ASAAS_BASE_URL:SANDBOX_URL,SALES_ASAAS_SANDBOX_API_KEY:'fixture-never-a-real-key'};
const reply=(body:unknown)=>new Response(JSON.stringify(body));
const original=global.fetch;

describe.each(['CHECK','COMMAND'] as const)('explicit empty refund envelope in %s',scope=>{
 let mock:jest.Mock,adapter:SalesAdjustmentCheckAdapter;
 beforeEach(()=>{mock=jest.fn();global.fetch=mock;adapter=new SalesAdjustmentCheckAdapter({get:(key:string)=>flags[key]} as any);});
 afterEach(()=>{global.fetch=original;});
 function history(body:unknown,initial=payment,after=initial){mock.mockResolvedValueOnce(reply(initial)).mockResolvedValueOnce(reply(body)).mockResolvedValueOnce(reply(after));}

 test('accepts exact null first page with bounded GETs, without storing arbitrary fields',async()=>{
  history({...empty,privateField:'never persist'});
  const result=await adapter.check(source,{amountCents:100},scope);
  expect(result).toMatchObject({complete:true,blockers:[],refunds:[],refundedCents:0,remainingCents:260000});
  expect(JSON.stringify(result)).not.toMatch(/privateField|never persist|fixture-never-a-real-key/);
  expect(mock).toHaveBeenCalledTimes(3);
  expect(mock.mock.calls.every(([url,opt])=>url.startsWith(SANDBOX_URL+'/payments/pay_test')&&opt.method==='GET'&&opt.redirect==='error'&&opt.body===undefined)).toBe(true);
  expect(mock.mock.calls[1][0]).toContain('/refunds?offset=0&limit=25');
 });
 test.each([
  {hasMore:false,totalCount:0},
  {data:{},hasMore:false,totalCount:0},
  {data:'',hasMore:false,totalCount:0},
  {data:null,totalCount:0},
  {data:null,hasMore:null,totalCount:0},
  {data:null,hasMore:'false',totalCount:0},
  {data:null,hasMore:true,totalCount:0},
  {data:null,hasMore:false},
  {data:null,hasMore:false,totalCount:null},
  {data:null,hasMore:false,totalCount:'0'},
  {data:null,hasMore:false,totalCount:1},
  {data:null,hasMore:false,totalCount:-1},
 ])('keeps ambiguous response blocked: %p',async body=>{
  history(body);
  expect(await adapter.check(source,{amountCents:100},scope)).toMatchObject({complete:false,blockers:['REFUNDS_INCOMPLETE','QUERY_SCHEMA_INVALID']});
  expect(mock).toHaveBeenCalledTimes(2);
 });
 test('null on later page does not clear an accumulated history into a complete result',async()=>{
  const rows=Array.from({length:25},(_,i)=>({id:'r_'+i,status:'CANCELLED',value:1,dateCreated:'2026-10-01'}));
  mock.mockResolvedValueOnce(reply(payment)).mockResolvedValueOnce(reply({data:rows,hasMore:true,totalCount:25})).mockResolvedValueOnce(reply(empty));
  const result=await adapter.check(source,{amountCents:100},scope);
  expect(result).toMatchObject({complete:false,blockers:['REFUNDS_INCOMPLETE','QUERY_SCHEMA_INVALID']});
  expect(result.refunds).toBeUndefined();expect(mock).toHaveBeenCalledTimes(3);
 });
 test.each([
  [{billingType:'BOLETO'},100,'METHOD_UNSUPPORTED'],
  [{status:'PENDING'},100,'PAYMENT_NOT_RECEIVED'],
  [{deleted:true},100,'PAYMENT_NOT_RECEIVED'],
  [{split:[{walletId:'fixture'}]},100,'SPLIT_REVIEW_REQUIRED'],
  [{},260001,'REFUND_EXCEEDS_EVIDENCE'],
 ] as const)('retains financial blocker %s',async(extra,amountCents,blocker)=>{
  history(empty,{...payment,...extra});
  expect((await adapter.check(source,{amountCents},scope)).blockers).toContain(blocker);
 });
 test('stable source is still mandatory after null empty history',async()=>{
  history(empty,payment,{...payment,status:'REFUND_REQUESTED'});
  expect((await adapter.check(source,{amountCents:100},scope)).blockers).toContain('REMOTE_SOURCE_CHANGED');
 });
 test('foreign payment binding fails before history query',async()=>{
  mock.mockResolvedValueOnce(reply({...payment,customer:'cus_other'}));
  await expect(adapter.check(source,{amountCents:100},scope)).rejects.toThrow();expect(mock).toHaveBeenCalledTimes(1);
 });
 test('null is not enabled for subscription payment enumeration',async()=>{
  const sub={id:'sub_test',customer:'cus_test',externalReference:'ref_sub',value:2600,cycle:'MONTHLY',billingType:'BOLETO',endDate:'2027-10-20',nextDueDate:'2026-11-20',status:'ACTIVE',deleted:false};
  const subSource={kind:'CANCEL_SUBSCRIPTION',remoteId:sub.id,verified:true,parameters:sub,subscriptionEvidence:{...sub,reference:sub.externalReference,grossCents:260000}};
  mock.mockResolvedValueOnce(reply(sub)).mockResolvedValueOnce(reply(empty));
  expect(await adapter.check(subSource,{},scope)).toMatchObject({complete:false,blockers:['PAYMENTS_INCOMPLETE','QUERY_SCHEMA_INVALID']});expect(mock).toHaveBeenCalledTimes(2);
 });
 test('scope-specific external gate still denies before fetch',async()=>{
  const gate=scope==='CHECK'?'SALES_ADJUSTMENT_CHECK_CALLS_ENABLED':'SALES_ADJUSTMENT_COMMAND_CALLS_ENABLED';
  adapter=new SalesAdjustmentCheckAdapter({get:(key:string)=>key===gate?'false':flags[key]} as any);
  await expect(adapter.check(source,{amountCents:100},scope)).rejects.toThrow();expect(mock).not.toHaveBeenCalled();
 });
});
