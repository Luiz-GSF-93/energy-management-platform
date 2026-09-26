import {OcrQueueService} from './ocr-queue.service';
function setup(){
 const source={organizationId:'org',documentId:'doc',fileHash:'hash',customerId:'customer',unitId:'unit',referenceMonth:'2026-08'};
 const assessment={version:'intake-assessment-v1',source,checkedAt:'2026-09-26T12:00:00Z',registration:{customer:{company_name:'private snapshot'}},intake:{decision:'REJECT_AUTOMATION',canImport:false,checks:[{field:'customer',state:'MISMATCH'}]}};
 const responses:any={document_ocr_jobs:{data:{id:'job',state:'SUCCEEDED'},error:null},documents:{data:{id:'doc',organization_id:'org',customer_id:'customer',consumer_unit_id:'unit',reference_month:'2026-08-01',file_hash:'hash',document_type:'INVOICE_DISTRIBUTOR',file_verified:true},error:null},document_ocr_results:{data:{file_hash:'hash',raw_result:{content:'',pages:[],documents:[]},evidence:{assessment}},error:null}};
 const queries:any[]=[];const from=jest.fn((table:string)=>{const q:any={table};for(const op of ['select','eq'])q[op]=jest.fn(()=>q);q.maybeSingle=jest.fn(async()=>responses[table]);queries.push(q);return q;});
 const connector={isConfigured:jest.fn(()=>true)};const service=new OcrQueueService({getClient:()=>({from})} as any,{requireEntitlement:async()=>{}} as any,connector as any);return {service,responses,queries,assessment,connector};
}
describe('persisted intake access boundaries',()=>{
 it('scopes every read and never exposes raw extraction or registration snapshot',async()=>{const s=setup();const result=await s.service.status('org','doc');expect(result.intake?.canImport).toBe(false);expect(result.intake?.decision).toBe('REJECT_AUTOMATION');expect(result).not.toHaveProperty('raw_result');expect(result.intake).not.toHaveProperty('registration');for(const q of s.queries)expect(q.eq).toHaveBeenCalledWith('organization_id','org');expect(s.queries.find(q=>q.table==='document_ocr_results').eq).toHaveBeenCalledWith('job_id','job');});
 it('stops when source hash differs from immutable evidence',async()=>{const s=setup();s.responses.document_ocr_results.data.file_hash='changed';await expect(s.service.status('org','doc')).rejects.toThrow('origem da extração');});
 it('fails closed when source lookup fails',async()=>{const s=setup();s.responses.documents={data:null,error:{}};await expect(s.service.status('org','doc')).rejects.toThrow('origem da extração');});
 it('keeps recorded rejection available with OCR disabled',async()=>{const s=setup();s.connector.isConfigured.mockReturnValue(false);const result=await s.service.status('org','doc');expect(result.enabled).toBe(false);expect(result.intake?.decision).toBe('REJECT_AUTOMATION');});
 it('does not recompute historical decisions against current registration',async()=>{const s=setup();await s.service.status('org','doc');expect(s.queries.map(q=>q.table)).toEqual(['document_ocr_jobs','documents','document_ocr_results']);});
 it.each(['fileHash','customerId','unitId','organizationId','documentId','referenceMonth'])('fails closed when snapshot %s differs',async key=>{const s=setup();(s.assessment.source as any)[key]='different';expect((await s.service.status('org','doc')).intake).toBeNull();});
 it('does not interpret legacy evidence without snapshot as approval',async()=>{const s=setup();delete s.responses.document_ocr_results.data.evidence.assessment;expect((await s.service.status('org','doc')).intake).toBeNull();});
 it('does not diagnose an unfinished job',async()=>{const s=setup();s.responses.document_ocr_jobs.data.state='POLLING';expect((await s.service.status('org','doc')).intake).toBeNull();expect(s.queries).toHaveLength(1);});
});

describe('technical readout access',()=>{
 it('keeps tenant, document and immutable job scope with processing disabled',async()=>{const s=setup();s.connector.isConfigured.mockReturnValue(false);expect(await s.service.readout('org','doc',{section:'fields'})).toMatchObject({rows:[]});for(const q of s.queries)expect(q.eq).toHaveBeenCalledWith('organization_id','org');expect(s.queries.find(q=>q.table==='document_ocr_results').eq).toHaveBeenCalledWith('job_id','job');});
 it.each([{page:'-1'},{page:['1','2']},{offset:'NaN'},{section:'raw'},{secret:'1'},{page:'1001'}])('rejects malformed query before database access: %j',async query=>{const s=setup();await expect(s.service.readout('org','doc',query)).rejects.toThrow();expect(s.queries).toHaveLength(0);});
 it('rejects mismatched origin',async()=>{const s=setup();s.responses.document_ocr_results.data.file_hash='other';await expect(s.service.readout('org','doc',{})).rejects.toThrow('origem da extração');});
 it('rejects mismatched assessment binding',async()=>{const s=setup();s.assessment.source.unitId='other';await expect(s.service.readout('org','doc',{})).rejects.toThrow('origem da extração');});
 it('does not expose unfinished or missing results',async()=>{const s=setup();s.responses.document_ocr_jobs.data.state='POLLING';await expect(s.service.readout('org','doc',{})).rejects.toThrow('concluída');expect(s.queries).toHaveLength(1);});
});
