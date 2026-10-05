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
