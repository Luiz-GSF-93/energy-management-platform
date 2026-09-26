import {OcrWorker} from './ocr.worker';
import {OcrProviderError} from './azure-invoice.connector';
const job={id:'job',lease_token:'lease',organization_id:'org',document_id:'doc',file_hash:'hash',state:'QUEUED',attempts:1};
function setup(state='QUEUED'){
 const rpc=jest.fn(async(name:string)=>name==='claim_document_ocr'?{data:[{...job,state}],error:null}:{data:{},error:null});
 const source={file_verified:true,document_type:'INVOICE_DISTRIBUTOR',storage_bucket:'energy-documents-private',file_hash:'hash',file_path:'org/unit/file.pdf',consumer_unit_id:'unit',file_size_bytes:3,mime_type:'application/pdf',original_filename:'test.pdf'};
 const query:any={select:jest.fn(()=>query),eq:jest.fn(()=>query),maybeSingle:jest.fn(async()=>({data:source,error:null}))};
 const download=jest.fn(async()=>({data:new Blob(['abc']),error:null}));
 const client={rpc,from:jest.fn(()=>query),storage:{from:jest.fn(()=>({download}))}};
 const connector={isConfigured:jest.fn(()=>true),submit:jest.fn(async()=>({url:'operation',retryAfterSeconds:5})),poll:jest.fn(async()=>({status:'running',retryAfterSeconds:5}))};
 const license={requireEntitlement:jest.fn(async()=>{})};
 const worker=new OcrWorker({getClient:()=>client} as any,license as any,connector as any);
 return {worker,rpc,source,connector,license,download};
}
describe('durable OCR worker',()=>{
 it('does nothing while disabled',async()=>{const s=setup();s.connector.isConfigured.mockReturnValue(false);await s.worker.runOnce();expect(s.rpc).not.toHaveBeenCalled();});
 it('commits intent before calling Azure and saves operation',async()=>{const s=setup();await s.worker.runOnce();expect(s.rpc.mock.calls.map(c=>c[0])).toEqual(['claim_document_ocr','transition_document_ocr','transition_document_ocr']);expect((s.rpc.mock.calls[1] as any)[1].p_action).toBe('BEGIN_SUBMISSION');expect((s.rpc.mock.calls[2] as any)[1].p_action).toBe('ACCEPTED');expect(s.rpc.mock.invocationCallOrder[1]).toBeLessThan(s.connector.submit.mock.invocationCallOrder[0]);});
 it('never submits when intent persistence fails',async()=>{const s=setup();s.rpc.mockImplementation(async(name:string)=>name==='claim_document_ocr'?{data:[job],error:null}:{data:null,error:{message:'offline'}} as any);await expect(s.worker.runOnce()).rejects.toThrow('OCR_STATE_NOT_CONFIRMED');expect(s.connector.submit).not.toHaveBeenCalled();});
 it('quarantines ambiguous network response',async()=>{const s=setup();s.connector.submit.mockRejectedValue(new OcrProviderError('SUBMISSION_UNKNOWN'));await s.worker.runOnce();expect((s.rpc.mock.calls.at(-1) as any)[1]).toMatchObject({p_action:'UNKNOWN',p_error:'SUBMISSION_UNKNOWN'});});
 it('only retries an explicitly throttled submission',async()=>{const s=setup();s.connector.submit.mockRejectedValue(new OcrProviderError('RATE_LIMITED',20));await s.worker.runOnce();expect((s.rpc.mock.calls.at(-1) as any)[1]).toMatchObject({p_action:'RETRY_SUBMISSION',p_delay:20});});
 it('polling never resubmits the file',async()=>{const s=setup('POLLING');await s.worker.runOnce();expect(s.connector.submit).not.toHaveBeenCalled();expect(s.download).not.toHaveBeenCalled();expect((s.rpc.mock.calls.at(-1) as any)[1].p_action).toBe('WAIT');});
 it('rejects storage paths outside the tenant',async()=>{const s=setup();s.source.file_path='other/unit/file.pdf';await s.worker.runOnce();expect(s.download).not.toHaveBeenCalled();expect(s.connector.submit).not.toHaveBeenCalled();});
 it('rechecks entitlement before sending',async()=>{const s=setup();s.license.requireEntitlement.mockRejectedValue(new Error('expired'));await s.worker.runOnce();expect(s.connector.submit).not.toHaveBeenCalled();expect((s.rpc.mock.calls.at(-1) as any)[1].p_error).toBe('LICENSE_UNAVAILABLE');});
 it('does not reclassify failed operation persistence as safe to resubmit',async()=>{const s=setup();let n=0;s.rpc.mockImplementation(async(name:string)=>{if(name==='claim_document_ocr')return {data:[job],error:null};n++;return {data:null,error:n===2?{}:null} as any;});await expect(s.worker.runOnce()).rejects.toThrow();expect(s.connector.submit).toHaveBeenCalledTimes(1);expect(s.rpc).toHaveBeenCalledTimes(3);});
});
