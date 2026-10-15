import {absencePage} from './sales-signature-absence.protocol';
import {SalesSignatureAbsenceService} from './sales-signature-absence.service';
import {signatureEnvelope,CLICKSIGN_SANDBOX_API} from './sales-signature-protocol';
import {SalesSignatureAdapter,SignatureDispatchFailure} from './sales-signature.adapter';
const id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',lease='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',accountKey='cccccccc-cccc-4ccc-8ccc-cccccccccccc',requestId='dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const name=signatureEnvelope(id).data.attributes.name,note='Private complete reconciliation fixture.';
const config=(extra={})=>({get:(key:string)=>({SALES_SIGNATURE_PREPARATION_ENABLED:'true',SALES_SIGNATURE_COMMANDS_ENABLED:'true',SALES_SIGNATURE_ABSENCE_ENABLED:'true',SALES_SIGNATURE_ABSENCE_CALLS_ENABLED:'true',SALES_SIGNATURE_ABSENCE_APPLICATION_ENABLED:'true',SALES_SIGNATURE_CALLS_ENABLED:'true',SALES_CLICKSIGN_SANDBOX_ACCOUNT_KEY:accountKey,SALES_CLICKSIGN_SANDBOX_TOKEN:'test-token-not-a-real-secret',SALES_CLICKSIGN_BASE_URL:CLICKSIGN_SANDBOX_API,...extra})[key]});
const empty={data:[],links:{next:null}},body={id,lease,requestId,justification:note};
const documentedEmpty=()=>({data:[],meta:{record_count:0},links:{first:CLICKSIGN_SANDBOX_API+'/envelopes',last:CLICKSIGN_SANDBOX_API+'/envelopes'}});
describe('Sandbox absence reconciliation, no live calls',()=>{
 const previous=global.fetch;afterEach(()=>{global.fetch=previous;});
 function setup(extra={}){const rpc=jest.fn().mockImplementation(async(_n,a)=>a.p_action==='begin'||a.p_action==='executionCheck'?{id,lease,accountKey}:a.p_action==='complete'?a.p_body.proof:{state:'AUTHORIZED'}),adapter={assertEnabled:jest.fn(),dispatch:jest.fn()};return {rpc,adapter,service:new SalesSignatureAbsenceService({rpc} as any,config(extra) as any,adapter as any)};}
 it('accepts only the documented zero-count first/last boundary without next',()=>{
  expect(absencePage(documentedEmpty(),name,new Set(),1)).toEqual({ids:[],next:null});
  const raw=documentedEmpty(),query='?'+new URLSearchParams({'filter[name]':name,'page[number]':'1','page[size]':'25'});
  raw.links.first+=query;raw.links.last+=query;
  expect(absencePage(raw,name,new Set(),1)).toEqual({ids:[],next:null});
 });
 it.each([undefined,null,'0',1,-1])('rejects missing or contradictory record count %j',count=>{
  const raw=documentedEmpty();(raw.meta as any).record_count=count;
  expect(()=>absencePage(raw,name,new Set(),1)).toThrow();
 });
 it.each([undefined,null,{},[]])('rejects absent empty metadata %j',meta=>{
  const raw:any=documentedEmpty();raw.meta=meta;
  expect(()=>absencePage(raw,name,new Set(),1)).toThrow();
 });
 it('does not accept missing next after an earlier page even when every page was empty',()=>{
  expect(()=>absencePage(documentedEmpty(),name,new Set(),2)).toThrow();
  expect(()=>absencePage(documentedEmpty(),name,new Set([lease]),1)).toThrow();
 });
 it.each([
  undefined,null,'','/api/v3/envelopes','https://evil.invalid/api/v3/envelopes',
  'http://sandbox.clicksign.com/api/v3/envelopes','https://app.clicksign.com/api/v3/envelopes',
  CLICKSIGN_SANDBOX_API+'/documents',CLICKSIGN_SANDBOX_API+'/envelopes#fragment',
  'https://user:password@sandbox.clicksign.com/api/v3/envelopes',
  CLICKSIGN_SANDBOX_API+'/envelopes?access_token=do-not-send',
  CLICKSIGN_SANDBOX_API+'/envelopes?filter[name]=other',
  CLICKSIGN_SANDBOX_API+'/envelopes?page[number]=2',
  CLICKSIGN_SANDBOX_API+'/envelopes?page[number]=1&page[number]=1',
  CLICKSIGN_SANDBOX_API+'/envelopes?page[size]=0',
  CLICKSIGN_SANDBOX_API+'/envelopes?page[size]=101',
 ])('rejects unsafe or incomplete empty boundary %j',boundary=>{
  for(const key of ['first','last']){const raw:any=documentedEmpty();raw.links[key]=boundary;expect(()=>absencePage(raw,name,new Set(),1)).toThrow();}
 });
 it('rejects different first and last boundaries or a previous page',()=>{
  const raw:any=documentedEmpty();raw.links.last+='?page[number]=1';expect(()=>absencePage(raw,name,new Set(),1)).toThrow();
  raw.links.first=raw.links.last;raw.links.prev=CLICKSIGN_SANDBOX_API+'/envelopes';expect(()=>absencePage(raw,name,new Set(),1)).toThrow();
 });
 it('never accepts a candidate through the empty boundary exception',()=>{
  const raw:any=documentedEmpty();raw.data=[{id:lease,type:'envelopes',attributes:{name}}];
  expect(()=>absencePage(raw,name,new Set(),1)).toThrow();
 });
 it('preserves a documented empty GET proof without authorizing or dispatching',async()=>{
  const {service,rpc,adapter}=setup();global.fetch=jest.fn().mockResolvedValue(new Response(JSON.stringify(documentedEmpty())));
  expect(await service.check(id,body)).toEqual({state:'EMPTY',pages:1,candidateIds:[],reason:null});
  expect(rpc.mock.calls.map(c=>c[1].p_action)).toEqual(['begin','complete']);expect(adapter.dispatch).not.toHaveBeenCalled();expect(global.fetch).toHaveBeenCalledTimes(1);
 });
 it('blocks a documented empty boundary returned after a non-final page',async()=>{
  const {service,adapter}=setup(),next=CLICKSIGN_SANDBOX_API+'/envelopes?'+new URLSearchParams({'filter[name]':name,'page[number]':'2'});
  global.fetch=jest.fn().mockResolvedValueOnce(new Response(JSON.stringify({data:[],links:{next}}))).mockResolvedValueOnce(new Response(JSON.stringify(documentedEmpty())));
  expect(await service.check(id,body)).toEqual({state:'INCOMPLETE',pages:1,candidateIds:[],reason:'FORMAT'});expect(adapter.dispatch).not.toHaveBeenCalled();
 });
 it.each([{data:[]},{data:[],links:{}},{data:null,links:{next:null}},{data:[],links:{next:'https://evil.invalid/'}},{data:[],links:{next:CLICKSIGN_SANDBOX_API+'/envelopes?page[number]=2'}},{data:[],links:{next:CLICKSIGN_SANDBOX_API+'/envelopes?'+new URLSearchParams({'filter[name]':name,'page[number]':'2',token:'secret'})}}])('rejects incomplete or unsafe page %j',raw=>expect(()=>absencePage(raw,name,new Set())).toThrow());
 it('does not accept renames or duplicate candidate IDs',()=>{const row={id:lease,type:'envelopes',attributes:{name}};expect(()=>absencePage({data:[row,row],links:{next:null}},name,new Set())).toThrow();expect(()=>absencePage({data:[{...row,attributes:{name:'other'}}],links:{next:null}},name,new Set())).toThrow();});
 it.each([{SALES_SIGNATURE_ABSENCE_ENABLED:'false'},{SALES_SIGNATURE_ABSENCE_CALLS_ENABLED:'false'},{SALES_CLICKSIGN_BASE_URL:'https://app.clicksign.com/api/v3'},{SALES_CLICKSIGN_SANDBOX_ACCOUNT_KEY:'24015'}])('blocks calls before reservation %j',async extra=>{const {service,rpc}=setup(extra);global.fetch=jest.fn();await expect(service.check(id,body)).rejects.toThrow();expect(rpc).not.toHaveBeenCalled();expect(global.fetch).not.toHaveBeenCalled();});
 it('persists empty proof but never dispatches or authorizes automatically',async()=>{const {service,rpc,adapter}=setup();global.fetch=jest.fn().mockResolvedValue(new Response(JSON.stringify(empty)));expect((await service.check(id,body)).state).toBe('EMPTY');expect(rpc.mock.calls.map(c=>c[1].p_action)).toEqual(['begin','complete']);expect(adapter.dispatch).not.toHaveBeenCalled();expect(global.fetch).toHaveBeenCalledTimes(1);expect((global.fetch as jest.Mock).mock.calls[0][1].method).toBe('GET');});
 it('requires explicit last page and blocks a pagination loop',async()=>{const {service}=setup();const next=CLICKSIGN_SANDBOX_API+'/envelopes?'+new URLSearchParams({'filter[name]':name,'page[number]':'2'});global.fetch=jest.fn().mockImplementation(async()=>new Response(JSON.stringify({data:[],links:{next}})));expect((await service.check(id,body)).reason).toBe('PAGINATION');expect(global.fetch).toHaveBeenCalledTimes(2);});
 it.each([[401,'HTTP'],[200,'FORMAT']])('sanitizes response %i without raw body',async(status,reason)=>{const {service}=setup();global.fetch=jest.fn().mockResolvedValue(new Response('secret-vendor-body',{status}));const proof=await service.check(id,body);expect(proof.reason).toBe(reason);expect(JSON.stringify(proof)).not.toContain('secret');});
 it('records a candidate without re-creating it',async()=>{const {service,adapter}=setup();global.fetch=jest.fn().mockResolvedValue(new Response(JSON.stringify({data:[{id:lease,type:'envelopes',attributes:{name}}],links:{next:null}})));expect((await service.check(id,body)).candidateIds).toEqual([lease]);expect(adapter.dispatch).not.toHaveBeenCalled();});
 it('does not scan after a lost begin transaction',async()=>{const {service,rpc}=setup();rpc.mockRejectedValue(Error('database'));global.fetch=jest.fn();await expect(service.check(id,body)).rejects.toThrow();expect(global.fetch).not.toHaveBeenCalled();});
 it('keeps execution off before any database or HTTP call',async()=>{const {service,rpc,adapter}=setup({SALES_SIGNATURE_ABSENCE_APPLICATION_ENABLED:'false'});global.fetch=jest.fn();await expect(service.execute(id,{id,resolutionId:requestId,justification:note})).rejects.toThrow();expect(rpc).not.toHaveBeenCalled();expect(adapter.dispatch).not.toHaveBeenCalled();expect(global.fetch).not.toHaveBeenCalled();});
 it('does not POST if immediate reconference finds a candidate',async()=>{const {service,rpc,adapter}=setup();global.fetch=jest.fn().mockResolvedValue(new Response(JSON.stringify({data:[{id:lease,type:'envelopes',attributes:{name}}],links:{next:null}})));await expect(service.execute(id,{id,resolutionId:requestId,justification:note})).rejects.toThrow();expect(rpc.mock.calls.map(c=>c[1].p_action)).toEqual(['executionCheck','complete']);expect(adapter.dispatch).not.toHaveBeenCalled();});
 it.each(['consume','reserve'])('does not POST after uncertain %s',async action=>{const {service,rpc,adapter}=setup();rpc.mockImplementation(async(_n,a)=>{if(a.p_action===action)throw Error('database');if(['executionCheck'].includes(a.p_action))return {id,lease,accountKey};if(a.p_action==='consume')return {id,lease,ordinal:1,step:'ENVELOPE',source:{draftSha256:'a'.repeat(64),parties:{}},dependencies:{}};return {};});global.fetch=jest.fn().mockResolvedValue(new Response(JSON.stringify(empty)));await expect(service.execute(id,{id,resolutionId:requestId,justification:note})).rejects.toThrow();expect(adapter.dispatch).not.toHaveBeenCalled();});
 it.each([false,true])('reserves before a single POST and never resends after lost finish=%s',async lost=>{const {service,rpc,adapter}=setup();rpc.mockImplementation(async(_n,a)=>{if(a.p_action==='executionCheck')return {id,lease,accountKey};if(a.p_action==='consume')return {id,lease,ordinal:1,step:'ENVELOPE',source:{draftSha256:'a'.repeat(64),parties:{}},dependencies:{}};if(a.p_action==='finish'&&lost)throw Error('database');return {};});adapter.dispatch.mockResolvedValue({externalId:lease,type:'envelopes'});global.fetch=jest.fn().mockResolvedValue(new Response(JSON.stringify(empty)));const run=service.execute(id,{id,resolutionId:requestId,justification:note});if(lost)await expect(run).rejects.toThrow();else await run;expect(rpc.mock.calls.map(c=>c[1].p_action)).toEqual(['executionCheck','complete','consume','reserve','finish']);expect(adapter.dispatch).toHaveBeenCalledTimes(1);expect(rpc.mock.invocationCallOrder[3]).toBeLessThan(adapter.dispatch.mock.invocationCallOrder[0]);});
 it('does not scan a mismatched account and preserves execution reservation',async()=>{const {service,rpc,adapter}=setup();rpc.mockResolvedValue({id,lease,accountKey:requestId});global.fetch=jest.fn();await expect(service.execute(id,{id,resolutionId:requestId,justification:note})).rejects.toThrow('Conta');expect(global.fetch).not.toHaveBeenCalled();expect(adapter.dispatch).not.toHaveBeenCalled();});
 it('keeps unknown history and sanitized diagnostics after a failed retry POST',async()=>{const {service,rpc,adapter}=setup();rpc.mockImplementation(async(_n,a)=>a.p_action==='executionCheck'?{id,lease,accountKey}:a.p_action==='consume'?{id,lease,ordinal:1,step:'ENVELOPE',source:{draftSha256:'a'.repeat(64),parties:{}},dependencies:{}}:{});adapter.dispatch.mockRejectedValue(new SignatureDispatchFailure('HTTP',401));global.fetch=jest.fn().mockResolvedValue(new Response(JSON.stringify(empty)));await expect(service.execute(id,{id,resolutionId:requestId,justification:note})).rejects.toThrow('incerta');expect(rpc.mock.calls.map(c=>c[1].p_action)).toEqual(['executionCheck','complete','consume','reserve','finish','diagnostic']);expect(rpc.mock.calls.at(-2)[1].p_body.result).toBeNull();expect(rpc.mock.calls.at(-1)[1].p_body.reason).toBe('HTTP');expect(adapter.dispatch).toHaveBeenCalledTimes(1);});
 it('passes exact Owner identity and requires provider confirmation reference',async()=>{const {service,rpc}=setup();await expect(service.authorize(id,{id,checkId:requestId,resolutionId:requestId,accountKey,providerReference:'',justification:note})).rejects.toThrow();expect(rpc).not.toHaveBeenCalled();await service.authorize(id,{id,checkId:requestId,resolutionId:requestId,accountKey,providerReference:'CLICK-TEST-123',justification:note});expect(rpc.mock.calls[0][1].p_actor).toBe(id);});
 it('preserves sanitised HTTP diagnostic on uncertain POST',async()=>{global.fetch=jest.fn().mockResolvedValue(new Response('DO-NOT-PERSIST',{status:401}));const adapter=new SalesSignatureAdapter(config() as any);try{await adapter.dispatch({id,lease,ordinal:1,step:'ENVELOPE',source:{draftSha256:'a'.repeat(64),parties:{} as any},dependencies:{}});throw Error('expected failure');}catch(e){expect(e).toBeInstanceOf(SignatureDispatchFailure);expect((e as SignatureDispatchFailure).diagnosticReason).toBe('HTTP');expect((e as SignatureDispatchFailure).diagnosticHttpStatus).toBe(401);expect(JSON.stringify(e)).not.toContain('DO-NOT-PERSIST');}});
});
