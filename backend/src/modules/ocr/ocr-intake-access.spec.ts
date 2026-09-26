import {OcrQueueService} from './ocr-queue.service';
function setup(){
 const responses:any={document_ocr_jobs:{data:{id:'job',state:'SUCCEEDED'},error:null},documents:{data:{id:'doc',customer_id:'customer',consumer_unit_id:'unit',reference_month:'2026-08-01',file_hash:'hash',document_type:'INVOICE_DISTRIBUTOR',file_verified:true},error:null},document_ocr_results:{data:{file_hash:'hash',raw_result:{content:'',pages:[],documents:[]}},error:null},customers:{data:{company_name:'Customer',document:'12345678000195'},error:null},consumer_units:{data:{consumer_unit_number:'001',free_market:true},error:null}};
 const queries:any[]=[];const from=jest.fn((table:string)=>{const q:any={table};for(const op of ['select','eq','neq','is'])q[op]=jest.fn(()=>q);q.maybeSingle=jest.fn(async()=>responses[table]);q.limit=jest.fn(async()=>({data:[{id:'another'}],error:null}));queries.push(q);return q;});
 const service=new OcrQueueService({getClient:()=>({from})} as any,{requireEntitlement:async()=>{}} as any,{isConfigured:()=>true} as any);return {service,responses,queries};
}
describe('intake access boundaries',()=>{
 it('scopes every read and never exposes raw extraction',async()=>{const s=setup();const result=await s.service.status('org','doc');expect(result.intake?.canImport).toBe(false);expect(result).not.toHaveProperty('raw_result');for(const q of s.queries)expect(q.eq).toHaveBeenCalledWith('organization_id','org');expect(s.queries.find(q=>q.table==='consumer_units').eq).toHaveBeenCalledWith('customer_id','customer');expect(s.queries.find(q=>q.table==='document_ocr_results').eq).toHaveBeenCalledWith('job_id','job');});
 it('stops when source hash differs from immutable evidence',async()=>{const s=setup();s.responses.document_ocr_results.data.file_hash='changed';await expect(s.service.status('org','doc')).rejects.toThrow('origem da extração');expect(s.queries.some(q=>q.table==='customers')).toBe(false);});
 it('fails closed when source lookup fails',async()=>{const s=setup();s.responses.documents={data:null,error:{}};await expect(s.service.status('org','doc')).rejects.toThrow('origem da extração');});
 it('fails closed on registration read errors',async()=>{const s=setup();s.responses.customers={data:null,error:{}};await expect(s.service.status('org','doc')).rejects.toThrow('cadastros');});
 it('does not diagnose an unfinished job',async()=>{const s=setup();s.responses.document_ocr_jobs.data.state='POLLING';expect((await s.service.status('org','doc')).intake).toBeNull();expect(s.queries).toHaveLength(1);});
});
