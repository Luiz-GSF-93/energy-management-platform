import 'reflect-metadata';
import {OcrQueueService} from './ocr-queue.service';
import {OcrCalculationContextService} from './ocr-calculation-context.service';
import {OcrCalculationContextController} from './ocr-calculation-context.controller';
import {PERMISSIONS_KEY} from '../../common/decorators/require-permission.decorator';
import {PERMISSIONS as P} from '../../common/constants/permissions';
const id='11111111-1111-4111-8111-111111111111';
function setup(state:string|null='FAILED'){
 const rows:any={documents:{id,organization_id:'org',customer_id:'customer',consumer_unit_id:'unit',reference_month:'2026-06-01',document_type:'INVOICE_DISTRIBUTOR',file_verified:true},consumer_units:{id:'unit',organization_id:'org',customer_id:'customer',status:'ACTIVE'},customers:{id:'customer',organization_id:'org',status:'ACTIVE'},document_ocr_jobs:state?{id:'job',state}:null};
 const calls:any[]=[];const from=jest.fn((table:string)=>{const filters:any={table};calls.push(filters);const q:any={select:()=>q,eq:(k:string,v:any)=>{filters[k]=v;return q;},is:(k:string,v:any)=>{filters[k]=v;return q;},maybeSingle:async()=>({data:rows[table],error:null})};return q;});
 const licenses={requireEntitlement:jest.fn(async()=>{})},rpc=jest.fn(),connector={isConfigured:jest.fn(),submit:jest.fn()};
 return {rows,calls,licenses,rpc,connector,queue:new OcrQueueService({getClient:()=>({from,rpc})} as any,licenses as any,connector as any)};
}
describe('Document navigation independent of OCR',()=>{
 it.each([null,'QUEUED','POLLING','FAILED','SUBMISSION_UNKNOWN','SUCCEEDED'])('resolves identity in %s without results or starting OCR',async state=>{const s=setup(state);expect(await s.queue.navigationContext('org',id)).toEqual({documentId:id,customerId:'customer',unitId:'unit',month:'2026-06',ocrState:state??'NOT_STARTED',canImport:false});expect(s.calls.every(c=>c.organization_id==='org')).toBe(true);expect(s.calls.map(c=>c.table)).toEqual(['documents','consumer_units','customers','document_ocr_jobs']);expect(s.rpc).not.toHaveBeenCalled();expect(s.connector.submit).not.toHaveBeenCalled();});
 it.each(['documents','consumer_units','customers'])('rejects foreign %s',async table=>{const s=setup();s.rows[table].organization_id='foreign';await expect(s.queue.navigationContext('org',id)).rejects.toThrow();});
 it.each(['customer_id','id','status'])('rejects changed unit %s',async key=>{const s=setup();s.rows.consumer_units[key]='changed';await expect(s.queue.navigationContext('org',id)).rejects.toThrow();});
 it('rejects unverified source and invalid month',async()=>{const s=setup();s.rows.documents.file_verified=false;await expect(s.queue.navigationContext('org',id)).rejects.toThrow();s.rows.documents.file_verified=true;s.rows.documents.reference_month='2026-13';await expect(s.queue.navigationContext('org',id)).rejects.toThrow();});
 it('preserves the license check',async()=>{const s=setup();s.licenses.requireEntitlement.mockRejectedValue(new Error('license'));await expect(s.queue.navigationContext('org',id)).rejects.toThrow('license');expect(s.calls).toHaveLength(0);});
 it('requires both permissions and never inspects preparation',async()=>{const s=setup(),prep={inspect:jest.fn()},service=new OcrCalculationContextService(s.queue,prep as any);expect(Reflect.getMetadata(PERMISSIONS_KEY,OcrCalculationContextController.prototype.navigation)).toEqual([P.DOCUMENTS_VIEW,P.ORGANIZATION_CONTRACTS_VIEW]);for(const p of [[P.DOCUMENTS_VIEW],[P.ORGANIZATION_CONTRACTS_VIEW],[]])await expect(service.navigation(id,{userId:'actor',organizationId:'org',permissions:p} as any)).rejects.toThrow();expect(s.calls).toHaveLength(0);await service.navigation(id,{userId:'actor',organizationId:'org',permissions:[P.DOCUMENTS_VIEW,P.ORGANIZATION_CONTRACTS_VIEW]} as any);expect(prep.inspect).not.toHaveBeenCalled();});
});
