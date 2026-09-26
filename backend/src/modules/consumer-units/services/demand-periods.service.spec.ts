import {demandPeriodInput,DemandPeriodsService} from './demand-periods.service';
import {DemandPeriodsController} from '../controllers/demand-periods.controller';
import {PERMISSIONS_KEY} from '../../../common/decorators/require-permission.decorator';
import {PERMISSIONS} from '../../../common/constants/permissions';
import 'reflect-metadata';
const id='00000000-0000-4000-8000-000000000001';
const input={startDate:'2026-01-01',endDate:'2026-12-31',modality:'GREEN',singleKw:'500',peakKw:null,offPeakKw:null,documentId:id,reason:'Cláusula 1',supersedesId:null,requestId:id};
describe('Demand period writes',()=>{
 it('validates green and blue',()=>{expect(demandPeriodInput(input).singleKw).toBe('500');expect(demandPeriodInput({...input,modality:'BLUE',singleKw:null,peakKw:'100',offPeakKw:'200'}).peakKw).toBe('100');});
 it.each([{startDate:'2026-02-30'},{endDate:'2025-01-01'},{organization_id:'other'},{singleKw:'1e3'},{singleKw:'-2'},{singleKw:500},{reason:''},{documentId:'x'},{supersedesId:'x'},{modality:'BLUE'},{peakKw:'10'}])('rejects invalid input %p',x=>expect(()=>demandPeriodInput({...input,...x})).toThrow());
 it('requires unit update permission',()=>expect(Reflect.getMetadata(PERMISSIONS_KEY,DemandPeriodsController.prototype.create)).toEqual([PERMISSIONS.ORGANIZATION_CONSUMER_UNITS_UPDATE]));
 it('also requires document access before reaching service',()=>{const service:any={create:jest.fn()};const c=new DemandPeriodsController(service);expect(()=>c.create('o','u','actor',input,{accessContext:{permissions:[PERMISSIONS.ORGANIZATION_CONSUMER_UNITS_UPDATE]}})).toThrow();expect(service.create).not.toHaveBeenCalled();});
 it('replays an identical request without writing',async()=>{const row={organization_id:'o',customer_id:'c',consumer_unit_id:'u',start_date:input.startDate,end_date:input.endDate,modality:'GREEN',single_kw:'500',peak_kw:null,off_peak_kw:null,document_id:id,reason:input.reason,supersedes_id:null,request_id:id,created_by:'actor',id:'saved'};const q:any={select:jest.fn().mockReturnThis(),eq:jest.fn().mockReturnThis(),maybeSingle:jest.fn().mockResolvedValue({data:row,error:null}),insert:jest.fn()};const service=new DemandPeriodsService({getClient:()=>({from:()=>q})} as any);jest.spyOn(service as any,'unit').mockResolvedValue({customer_id:'c'});expect(await service.create('o','u','actor',input)).toEqual({id:'saved',canImport:false});expect(q.insert).not.toHaveBeenCalled();await expect(service.create('o','u','other',input)).rejects.toThrow('outros dados');});
});
