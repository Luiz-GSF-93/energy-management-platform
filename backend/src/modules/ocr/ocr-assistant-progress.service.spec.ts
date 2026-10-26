import {OcrAssistantProgressService} from './ocr-assistant-progress.service';
import {PERMISSIONS as P} from '../../common/constants/permissions';
describe('read-only assistant preparation progress',()=>{
 const tenant:any={organizationId:'org',userId:'actor',role:'operacional',permissions:['view']};
 it('reports real completed stages, deduplicates running work and returns only owned proposals',async()=>{
  let resolve:any;let progress:any;
  const assistant:any={authorize:jest.fn(async()=>{}),inspect:jest.fn((_d,_t,p)=>{progress=p;return new Promise(r=>{resolve=r;});})};
  const service=new OcrAssistantProgressService(assistant),job=await service.start('doc',tenant);
  expect(job.state).toBe('RUNNING');expect(job.completed).toEqual([]);
  expect((await service.start('doc',tenant)).id).toBe(job.id);expect(assistant.inspect).toHaveBeenCalledTimes(1);
  progress('source');progress('source');expect((await service.status('doc',job.id,tenant)).completed).toEqual(['source']);
  await expect(service.status('doc',job.id,{...tenant,organizationId:'other'})).rejects.toThrow();
  await expect(service.status('other-doc',job.id,tenant)).rejects.toThrow();
  await expect(service.status('doc',job.id,{...tenant,userId:'other'})).rejects.toThrow();
  await expect(service.status('doc',job.id,{...tenant,permissions:[]})).rejects.toThrow();
  resolve({token:'private'});await Promise.resolve();
  expect((await service.status('doc',job.id,tenant)).plan).toEqual({token:'private'});
 });
 it('does not expose errors or retry writes and fails closed after restart/expiry',async()=>{
  const assistant:any={authorize:jest.fn(async()=>{}),inspect:jest.fn(async()=>{throw Error('private supplier data');})};
  const service=new OcrAssistantProgressService(assistant),job=await service.start('doc',tenant);
  await Promise.resolve();await Promise.resolve();const result=await service.status('doc',job.id,tenant);
  expect(result.state).toBe('FAILED');expect(result.message).not.toContain('private');expect(result.plan).toBeUndefined();
  await expect(new OcrAssistantProgressService(assistant).status('doc',job.id,tenant)).rejects.toThrow('expirada');
  (service as any).jobs.get(job.id).expires=0;await expect(service.status('doc',job.id,tenant)).rejects.toThrow('expirada');
 });
 it('checks current authorization before starting or returning any cached result',async()=>{
  const assistant:any={authorize:jest.fn(async()=>{throw Error('license');}),inspect:jest.fn()};
  await expect(new OcrAssistantProgressService(assistant).start('doc',tenant)).rejects.toThrow('license');expect(assistant.inspect).not.toHaveBeenCalled();
 });
 it('saves extracted drafts while inference is pending and preserves them if annotation persistence fails',async()=>{
  const authorized={...tenant,permissions:[P.ORGANIZATION_CONTRACTS_UPDATE]};
  const plan={documentId:'doc',unitName:'Unit',month:'2026-08',counts:{blockers:0,reviews:1},fieldTasks:[],records:{measurements:{status:'DRAFT'},costs:{status:'DRAFT'}}};
  let resolveInference!:(value:any)=>void;
  const assistant:any={authorize:jest.fn(async()=>{}),inspect:jest.fn(async()=>plan)};
  const ai:any={interpret:jest.fn(()=>new Promise(resolve=>{resolveInference=resolve;}))};
  const drafts:any={fill:jest.fn().mockResolvedValueOnce({state:'FILLED_DRAFT',count:1,message:'Saved'}).mockRejectedValueOnce(new Error('private storage error'))};
  const service=new OcrAssistantProgressService(assistant,ai,drafts),job=await service.start('doc',authorized);
  await new Promise(resolve=>setImmediate(resolve));
  expect(drafts.fill).toHaveBeenCalledTimes(1);
  expect(drafts.fill).toHaveBeenNthCalledWith(1,authorized,plan);
  expect((await service.status('doc',job.id,authorized)).completed).toContain('autofill');
  expect((await service.status('doc',job.id,authorized)).state).toBe('RUNNING');
  expect(((await service.status('doc',job.id,authorized)).plan as any).automaticFill.state).toBe('FILLED_DRAFT');
  await expect(service.status('doc',job.id,{...authorized,organizationId:'other'})).rejects.toThrow();
  resolveInference({state:'READY',checkedAt:'now',message:'Ready',fields:[],doubts:[],evidence:[]});
  await new Promise(resolve=>setImmediate(resolve));
  const result=await service.status('doc',job.id,authorized);
  expect(result.state).toBe('READY');
  expect((result.plan as any).automaticFill.state).toBe('FILLED_DRAFT');
  expect((result.plan as any).automaticFill.count).toBe(1);
  expect(JSON.stringify(result)).not.toContain('private storage error');
 });
 it('does not persist drafts without draft permission even when the assistant is readable',async()=>{
  const plan={unitName:'Unit',month:'2026-08',counts:{blockers:0,reviews:0},records:{measurements:{status:'DRAFT'},costs:{status:'DRAFT'}}};
  const drafts:any={fill:jest.fn()},assistant:any={authorize:jest.fn(async()=>{}),inspect:jest.fn(async()=>plan)};
  const service=new OcrAssistantProgressService(assistant,undefined,drafts);
  await service.start('doc',tenant);await new Promise(resolve=>setImmediate(resolve));
  expect(drafts.fill).not.toHaveBeenCalled();
 });
});


describe('automatic closing from Documents',()=>{
 const tenant:any={organizationId:'org',userId:'actor',roleId:'role',role:'admin_org',permissions:[P.ENERGIA_OCR_PROCESS,P.ORGANIZATION_CONTRACTS_CREATE]},plan:any={documentId:'doc',sourceHash:'a'.repeat(64),unitId:'unit',month:'2026-06',unitName:'Unit',counts:{blockers:20,reviews:1},records:{measurements:{status:'DRAFT'},costs:{status:'DRAFT'}},values:[],findings:[],operations:[]};
 const next=()=>new Promise(resolve=>setImmediate(resolve));
 it('fills the closing before explanatory IA and preserves it if IA is unavailable',async()=>{const calls:string[]=[],assistant:any={authorize:jest.fn(),inspect:jest.fn(async()=>plan),prepareAutomatic:jest.fn(async()=>({complete:true,receipts:[],current:plan}))},closing:any={prepareInvoice:jest.fn(async()=>{calls.push('closing');return {row:{id:'closing',version:2,report:{preparation:{percent:100},approvalEligible:false,units:[{id:'unit',fields:[{state:'FILLED',value:'1',source:'NF'}]}],pendingActions:[{code:'CCEE_ESTIMATE_REVIEW',message:'Revisar estimativa'}],proposalFinancial:{acr:'100.00'}}}};})},ai:any={interpret:jest.fn(async()=>{calls.push('ai');throw Error('private provider error');})},service=new OcrAssistantProgressService(assistant,ai,undefined,closing),job=await service.start('doc',tenant);await next();const result=await service.status('doc',job.id,tenant);expect(calls).toEqual(['closing','ai']);expect(result.state).toBe('READY');expect((result.plan as any).financialPreparation).toMatchObject({percent:100,closingId:'closing',state:'FILLED_REVIEW_REQUIRED',canPublish:false,financialApproval:false});expect(JSON.stringify(result)).not.toContain('private provider error');expect(closing.prepareInvoice).toHaveBeenCalledTimes(1);});
 it.each(['uncertain','failed','reader'])('does not resume an uncertain write or expand permissions: %s',async mode=>{const assistant:any={authorize:jest.fn(),inspect:jest.fn(async()=>plan),prepareAutomatic:jest.fn(async()=>{if(mode==='failed')throw Error('unknown');return {complete:true,receipts:[{state:'VERIFY_REQUIRED'}]};})},closing:any={prepareInvoice:jest.fn()},service=new OcrAssistantProgressService(assistant,undefined,undefined,closing);await service.start('doc',mode==='reader'?{...tenant,permissions:[]}:tenant);await next();expect(closing.prepareInvoice).not.toHaveBeenCalled();});
});
