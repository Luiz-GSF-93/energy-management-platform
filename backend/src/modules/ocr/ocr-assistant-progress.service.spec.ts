import {OcrAssistantProgressService} from './ocr-assistant-progress.service';
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
});
