import {OcrIdentityService} from './ocr-identity.service';
import {OcrController} from './ocr.controller';
import {PERMISSIONS_KEY} from '../../common/decorators/require-permission.decorator';
import {PERMISSIONS} from '../../common/constants/permissions';
import 'reflect-metadata';
function setup(){const q:any={select:jest.fn(()=>q),eq:jest.fn(()=>q),is:jest.fn(()=>q),neq:jest.fn(()=>q),maybeSingle:jest.fn(async()=>({data:null,error:null})),limit:jest.fn(async()=>({data:[],error:null}))};const client={from:jest.fn(()=>q)};const queue={reviewSource:jest.fn(async()=>({raw:{},doc:{id:'doc',customer_id:'customer',consumer_unit_id:'unit',reference_month:'2026-08-01'},assessment:{checkedAt:'2026-09-01'}}))};return {q,queue,client,service:new OcrIdentityService({getClient:()=>client} as any,queue as any)};}
describe('identity preview access',()=>{
 it('requires document view permission',()=>expect(Reflect.getMetadata(PERMISSIONS_KEY,OcrController.prototype.identityPreview)).toEqual([PERMISSIONS.DOCUMENTS_VIEW]));
 it('scopes each query to tenant and exact document links',async()=>{const s=setup();const r=await s.service.preview('org','doc');expect(s.queue.reviewSource).toHaveBeenCalledWith('org','doc');expect(s.q.eq.mock.calls.filter((v:any[])=>v[0]==='organization_id')).toEqual([['organization_id','org'],['organization_id','org'],['organization_id','org']]);for(const pair of [['id','customer'],['id','unit'],['customer_id','customer'],['consumer_unit_id','unit'],['reference_month','2026-08-01']])expect(s.q.eq).toHaveBeenCalledWith(...pair);expect(s.q.is).toHaveBeenCalledWith('deleted_at',null);expect(s.q.neq).toHaveBeenCalledWith('id','doc');expect(r.canImport).toBe(false);expect(r.historicalCheckedAt).toBe('2026-09-01');});
 it('fails before querying registration when source is inaccessible',async()=>{const s=setup();s.queue.reviewSource.mockRejectedValue(new Error('source') as never);await expect(s.service.preview('foreign','doc')).rejects.toThrow('source');expect(s.client.from).not.toHaveBeenCalled();});
 it('fails closed on database error',async()=>{const s=setup();s.q.maybeSingle.mockResolvedValue({data:null,error:{message:'error'}});await expect(s.service.preview('org','doc')).rejects.toThrow('cadastro atual');});
 it('does not treat unavailable duplicate query as no duplicates',async()=>{const s=setup();s.q.limit.mockResolvedValue({data:null,error:null});await expect(s.service.preview('org','doc')).rejects.toThrow('cadastro atual');});
});
