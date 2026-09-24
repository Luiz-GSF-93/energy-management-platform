import { DocumentsService } from './documents.service';
import { inspectDocument, MAX_DOCUMENT_BYTES } from './document-file';
import { createHash } from 'crypto';
const id='00000000-0000-4000-8000-000000000001';
const dto={customerId:id,consumerUnitId:id,documentType:'INVOICE_DISTRIBUTOR',referenceMonth:'2026-09-01'};
const file={buffer:Buffer.from('%PDF-1.4\nfixture\n%%EOF'),originalname:'invoice.pdf',mimetype:'application/pdf',size:1};
describe('Private document upload',()=>{
 let service:DocumentsService, storage:any, docs:any, inserted:any, from:jest.Mock;
 beforeEach(()=>{
  inserted=undefined;
  storage={upload:jest.fn().mockResolvedValue({error:null}),remove:jest.fn().mockResolvedValue({error:null}),createSignedUrl:jest.fn().mockResolvedValue({data:{signedUrl:'https://storage.example/file'},error:null})};
  docs={};for(const k of ['select','eq','is']) docs[k]=jest.fn(()=>docs);
  docs.insert=jest.fn((rows)=>{inserted=rows[0];return docs;});
  docs.single=jest.fn(async()=>({data:{id,...inserted},error:null}));docs.maybeSingle=jest.fn().mockResolvedValue({data:null,error:null});
  const parent:any={};for(const k of ['select','eq','is']) parent[k]=jest.fn(()=>parent);parent.maybeSingle=jest.fn().mockResolvedValue({data:{id,customer_id:id},error:null});
  from=jest.fn(t=>t==='documents'?docs:parent);
  service=new DocumentsService({getClient:()=>({from,storage:{from:()=>storage}})} as any,{requireEntitlement:jest.fn()} as any);
 });
 it('hashes actual bytes and stores under a random private key',async()=>{
  const row=await service.upload(dto,file,'org-a',id);
  expect(row.file_hash).toBe(createHash('sha256').update(file.buffer).digest('hex'));
  expect(row.file_size_bytes).toBe(file.buffer.length);expect(row.file_verified).toBe(true);
  expect(row.storage_bucket).toBe('energy-documents-private');expect(row.processing_status).toBe('PENDING');
  expect(storage.upload).toHaveBeenCalledWith(expect.stringMatching(new RegExp('^org-a/'+id+'/[a-f0-9-]+\\.pdf$')),file.buffer,{contentType:'application/pdf',upsert:false});
 });
 it('rejects client-supplied hash before storage',async()=>{
  await expect(service.upload({...dto,fileHash:'forged'} as any,file,'org-a',id)).rejects.toMatchObject({status:400});expect(storage.upload).not.toHaveBeenCalled();
 });
 it('rejects missing file',async()=>{await expect(service.upload(dto,undefined,'org-a',id)).rejects.toMatchObject({status:400});});
 it('rejects foreign unit before storage',async()=>{
  from.mockReturnValue(docs);await expect(service.upload(dto,file,'org-a',id)).rejects.toMatchObject({status:404});expect(storage.upload).not.toHaveBeenCalled();
 });
 it('blocks known duplicate before storage',async()=>{
  docs.maybeSingle.mockResolvedValue({data:{id},error:null});await expect(service.upload(dto,file,'org-a',id)).rejects.toMatchObject({status:409});expect(storage.upload).not.toHaveBeenCalled();
 });
 it.each([{code:'23502'},{code:'23503'},{code:'23514'},{code:'23505',message:'duplicate'},{code:'P0001',message:'DOCUMENT_QUOTA_EXCEEDED'}])('compensates a confirmed rejected insert %p',async error=>{
  docs.single.mockResolvedValue({data:null,error});await expect(service.upload(dto,file,'org-a',id)).rejects.toBeDefined();
  expect(storage.remove).toHaveBeenCalledWith([storage.upload.mock.calls[0][0]]);
 });
 it('cleans an object when storage response fails before insert',async()=>{
  storage.upload.mockRejectedValue(new Error('transport'));await expect(service.upload(dto,file,'org-a',id)).rejects.toMatchObject({status:503});expect(storage.remove).toHaveBeenCalled();expect(docs.insert).not.toHaveBeenCalled();
 });
 it('reports compensation failure',async()=>{
  docs.single.mockResolvedValue({data:null,error:{code:'23505'}});storage.remove.mockResolvedValue({error:{message:'unavailable'}});
  await expect(service.upload(dto,file,'org-a',id)).rejects.toThrow('limpeza');
 });
 it('recovers a committed row after losing the insert response',async()=>{
  docs.single.mockRejectedValue(new Error('transport'));
  docs.maybeSingle.mockResolvedValueOnce({data:null,error:null}).mockImplementationOnce(async()=>({data:{id,...inserted},error:null}));
  expect((await service.upload(dto,file,'org-a',id)).id).toBe(id);expect(storage.remove).not.toHaveBeenCalled();
 });
 it('never removes bytes when insert outcome cannot be established',async()=>{
  docs.single.mockRejectedValue(new Error('transport'));
  await expect(service.upload(dto,file,'org-a',id)).rejects.toThrow('indeterminado');expect(storage.remove).not.toHaveBeenCalled();
 });
 it('signs only verified tenant-scoped files for 60 seconds',async()=>{
  docs.maybeSingle.mockResolvedValue({data:{id,consumer_unit_id:id,file_verified:true,storage_bucket:'energy-documents-private',file_path:`org-a/${id}/file.pdf`,original_filename:'invoice.pdf'},error:null});
  expect((await service.download(id,'org-a')).expiresIn).toBe(60);expect(docs.eq).toHaveBeenCalledWith('organization_id','org-a');expect(storage.createSignedUrl).toHaveBeenCalledWith(`org-a/${id}/file.pdf`,60,{download:'invoice.pdf'});
 });
 it('does not sign unverified metadata',async()=>{docs.maybeSingle.mockResolvedValue({data:{id,file_verified:false},error:null});await expect(service.download(id,'org-a')).rejects.toMatchObject({status:409});expect(storage.createSignedUrl).not.toHaveBeenCalled();});
 it('does not sign a foreign document',async()=>{await expect(service.download(id,'org-b')).rejects.toMatchObject({status:404});expect(storage.createSignedUrl).not.toHaveBeenCalled();});
 it.each([Buffer.from('<html>bad</html>'),Buffer.from('%PDF-1.4 incomplete')])('rejects unsupported/truncated signature',buffer=>{expect(()=>inspectDocument({...file,buffer})).toThrow();});
 it('rejects mismatched declared MIME',()=>{expect(()=>inspectDocument({...file,mimetype:'image/png'})).toThrow();});
 it('enforces actual buffer size',()=>{expect(()=>inspectDocument({...file,buffer:Buffer.alloc(MAX_DOCUMENT_BYTES+1)})).toThrow();});
});
