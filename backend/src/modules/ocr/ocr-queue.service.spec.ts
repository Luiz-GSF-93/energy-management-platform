import {OcrQueueService} from './ocr-queue.service';
import {OcrController} from './ocr.controller';
import {PERMISSIONS_KEY} from '../../common/decorators/require-permission.decorator';
import {PERMISSIONS} from '../../common/constants/permissions';
import 'reflect-metadata';
function setup(){const query:any={select:jest.fn(()=>query),eq:jest.fn(()=>query),maybeSingle:jest.fn(async()=>({data:{id:'doc'},error:null}))};const client={from:jest.fn(()=>query),rpc:jest.fn(async()=>({data:{id:'job',state:'QUEUED',operation_url:'private'},error:null}))};const connector={isConfigured:jest.fn(()=>true)};return {query,client,connector,service:new OcrQueueService({getClient:()=>client} as any,{requireEntitlement:async()=>{}} as any,connector as any)};}
describe('OCR queue API boundaries',()=>{
 it('requires OCR processing permission (view alone is insufficient)',()=>expect(Reflect.getMetadata(PERMISSIONS_KEY,OcrController.prototype.enqueue)).toEqual([PERMISSIONS.ENERGIA_OCR_PROCESS]));
 it('disabled status makes no database or provider call',async()=>{const s=setup();s.connector.isConfigured.mockReturnValue(false);expect(await s.service.status('org','doc')).toEqual({enabled:false,job:null});expect(s.client.from).not.toHaveBeenCalled();});
 it('does not enqueue while disabled',async()=>{const s=setup();s.connector.isConfigured.mockReturnValue(false);await expect(s.service.enqueue('org','doc','actor')).rejects.toThrow();expect(s.client.rpc).not.toHaveBeenCalled();});
 it('scopes document lookup and status by organization',async()=>{const s=setup();await s.service.enqueue('org','doc','actor');expect(s.query.eq).toHaveBeenCalledWith('organization_id','org');expect(s.client.rpc).toHaveBeenCalledWith('enqueue_document_ocr',{p_org:'org',p_document:'doc',p_actor:'actor'});});
 it('cannot enqueue a document not found in this tenant',async()=>{const s=setup();s.query.maybeSingle.mockResolvedValue({data:null,error:null});await expect(s.service.enqueue('org','other','actor')).rejects.toThrow('Documento não encontrado.');expect(s.client.rpc).not.toHaveBeenCalled();});
 it('does not expose operation URL to the browser',async()=>{const s=setup();expect(await s.service.enqueue('org','doc','actor')).not.toHaveProperty('operation_url');});
});
