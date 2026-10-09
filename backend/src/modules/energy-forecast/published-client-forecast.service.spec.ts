import {PublishedClientForecastService} from './published-client-forecast.service';
import {reportHash} from '../reports/report.projection';
import {PERMISSIONS as P} from '../../common/constants/permissions';
describe('client published forecast projection',()=>{
 const t:any={organizationId:'org',userId:'actor',roleId:'client-role',role:'consulta',permissions:[P.DOCUMENTS_REPORTS_VIEW]};
 const body:any={organizationId:'org',customerId:'customer',unitId:'unit',asOfMonth:'2026-08',method:'MONTHLY_MEAN_DAILY',formulaVersion:'consumption-forecast/1.2',actual:[{month:'2026-08',consumptionKwh:'10',evidence:{private:'OCR'}}],future:[{month:'2026-09',predictedKwh:'20',expansionKwh:'0',averageSourceMonths:['2024-09','2025-09']}],observedYearKwh:'10',futureKwh:'20',estimatedYearKwh:'30',weatherStatus:'NOT_REQUESTED',weather:{private:'coordinates'},qualifications:['private review'],expansions:[{private:'notes'}]};
 let rpc:jest.Mock,licenses:jest.Mock,service:PublishedClientForecastService,row:any;
 beforeEach(()=>{
  row={id:'run',version:1,organization_id:'org',customer_id:'customer',consumer_unit_id:'unit',cutoff:'2026-08',body,payload_hash:reportHash(body),publishedAt:'2026-09-01T00:00:00Z',validatedAt:'2026-09-01T00:00:00Z'};
  rpc=jest.fn().mockImplementation(async()=>({data:{customerId:'customer',rows:[row]},error:null}));licenses=jest.fn();
  service=new PublishedClientForecastService({getClient:()=>({rpc})} as any,{requireEntitlement:licenses} as any,{get:()=> 'true'} as any);
 });
 it('derives scope using no caller-controlled customer and removes internal source data',async()=>{
  const result=await service.list(t);expect(rpc).toHaveBeenCalledWith('energy_forecast_client_published',{p_org:'org',p_actor:'actor',p_role:'client-role'});
  expect(JSON.stringify(result)).not.toMatch(/private|coordinates|OCR|averageSourceMonths|payload_hash|qualifications/);expect(result.rows[0].futureKwh).toBe('20');
 });
 it.each([{role:'gestor'},{accessMode:'platform_operation'},{permissions:[]},{roleId:''}])('blocks incompatible context %j before SQL',async patch=>{
  await expect(service.list({...t,...patch})).rejects.toThrow();expect(rpc).not.toHaveBeenCalled();
 });
 it.each(['organization_id','customer_id','consumer_unit_id','payload_hash'])('rejects incompatible %s',async key=>{
  row[key]='wrong';await expect(service.list(t)).rejects.toThrow('Integridade');
 });
 it('does not render validated-only versions',async()=>{row.publishedAt=null;await expect(service.list(t)).rejects.toThrow('Integridade');});
 it('requires both existing entitlements',async()=>{licenses.mockRejectedValue(new Error('license'));await expect(service.list(t)).rejects.toThrow('license');expect(rpc).not.toHaveBeenCalled();});
 it('returns an empty list without synthetic data',async()=>{rpc.mockResolvedValue({data:{customerId:'customer',rows:[]},error:null});expect(await service.list(t)).toEqual({rows:[]});});
});
