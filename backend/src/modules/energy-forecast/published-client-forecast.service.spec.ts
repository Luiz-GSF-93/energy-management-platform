import {calculateConsumptionForecast} from './consumption-forecast';
import {PublishedClientForecastService} from './published-client-forecast.service';
import {reportHash} from '../reports/report.projection';
import {PERMISSIONS as P} from '../../common/constants/permissions';
describe('client published forecast projection',()=>{
 const t:any={organizationId:'org',userId:'actor',roleId:'client-role',role:'consulta',permissions:[P.DOCUMENTS_REPORTS_VIEW]};
 const body:any={organizationId:'org',customerId:'customer',unitId:'unit',asOfMonth:'2026-08',method:'MONTHLY_MEAN_DAILY',formulaVersion:'consumption-forecast/1.2',actual:[{month:'2026-08',consumptionKwh:'10',evidence:{private:'OCR'}}],future:[{month:'2026-09',predictedKwh:'20',expansionKwh:'0',averageSourceMonths:['2024-09','2025-09']}],observedYearKwh:'10',futureKwh:'20',estimatedYearKwh:'30',weatherStatus:'NOT_REQUESTED',weather:{private:'coordinates'},qualifications:['private review'],expansions:[{private:'notes'}]};
 let rpc:jest.Mock,licenses:jest.Mock,service:PublishedClientForecastService,row:any;
 beforeEach(()=>{
  row={id:'run',version:1,organization_id:'org',customer_id:'customer',consumer_unit_id:'unit',cutoff:'2026-08',body,payload_hash:reportHash(body),publishedAt:'2026-09-01T00:00:00Z',validatedAt:'2026-09-01T00:00:00Z'};
  rpc=jest.fn().mockImplementation(async(name)=>name==='energy_forecast_client_sources'?{data:{customerId:'customer',units:[]},error:null}:{data:{customerId:'customer',rows:[row]},error:null});licenses=jest.fn();
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
 it('returns an empty list without synthetic data',async()=>{rpc.mockImplementation(async(name)=>({data:name==='energy_forecast_client_sources'?{customerId:'customer',units:[]}:{customerId:'customer',rows:[]},error:null}));expect(await service.list(t)).toEqual({rows:[],currentPlanning:[]});});
 it('calculates without a manual forecast and exposes only aggregate planning data',async()=>{
  const publications=Array.from({length:12},(_,i)=>({customerId:'customer',unitId:'unit',month:new Date(Date.UTC(2025,9+i,1)).toISOString().slice(0,7),publicationId:'p'+i,sourceHash:'a'.repeat(64),publishedAt:'2026-10-01T00:00:00Z',fields:[{key:'consumptionTotal',value:'30000'},{key:'consumptionPeak',value:'1000'},{key:'consumptionOffPeak',value:'29000'}],tariffLines:[{component:'TE',billedDays:'30'},{component:'TE',billedDays:'30'}]}));
  rpc.mockImplementation(async(name)=>({data:name==='energy_forecast_client_sources'?{customerId:'customer',units:[{organizationId:'org',customerId:'customer',unitId:'unit',unitName:'Tennis',publications,invoice:null,ccee:[]}]}:{customerId:'customer',rows:[]},error:null}));
  const result:any=await service.list(t);expect(result.rows).toEqual([]);expect(result.currentPlanning[0].forecastId).toBe('planning:unit');expect(result.currentPlanning[0].state).toBe('AVAILABLE');expect(result.currentPlanning[0].forecast.future).toHaveLength(3);expect(result.currentPlanning[0].forecast.version).toBeUndefined();expect(JSON.stringify(result)).not.toMatch(/evidence|validatedBy|raw|authorizationId|customerId/);
 });
 it('rejects cross-customer source units even without a historical forecast',async()=>{
  rpc.mockImplementation(async(name)=>({data:name==='energy_forecast_client_sources'?{customerId:'customer',units:[{organizationId:'org',customerId:'foreign',unitId:'unit',publications:[]}]}:{customerId:'customer',rows:[]},error:null}));await expect(service.list(t)).rejects.toThrow('Integridade');
 });
});

 it('projects updated public measurements without changing the previously published forecast or exposing sources',async()=>{
  const scope={organizationId:'org',customerId:'customer',unitId:'unit'},observations=Array.from({length:12},(_,i)=>{const d=new Date(Date.UTC(2025,9+i,1)),month=d.toISOString().slice(0,7);return {month,consumptionKwh:'100000',billedDays:30,evidence:{...scope,id:month,revision:1,hash:'a'.repeat(64),validatedBy:'review',validatedAt:'2026-10-01T00:00:00Z'}};});
  const body=calculateConsumptionForecast({...scope,asOfMonth:'2026-09',observations,expansions:[]});
  const row={id:'current',version:1,organization_id:'org',customer_id:'customer',consumer_unit_id:'unit',cutoff:'2026-09',body,payload_hash:reportHash(body),publishedAt:'2026-10-01T00:00:00Z',validatedAt:'2026-10-01T00:00:00Z'};
  const source={publicationId:'jan-publication',sourceHash:'b'.repeat(64),publishedAt:'2026-10-23T00:00:00Z',customerId:'customer',unitId:'unit',month:'2026-01',fields:[{key:'consumptionTotal',value:'105223.6617'},{key:'consumptionPeak',value:'0'},{key:'consumptionOffPeak',value:'105223.6617'}]};
  let revoked=false;
  const rpc=jest.fn(async(name:string,p:any)=>name==='energy_forecast_client_published'?{data:{customerId:'customer',rows:[row]},error:null}:name==='energy_forecast_client_sources'?{data:{customerId:'customer',units:[]},error:null}:revoked?{data:null,error:{code:'42501'}}:{data:p.p_from==='2026-01'?[source]:[],error:null});
  const service=new PublishedClientForecastService({getClient:()=>({rpc})} as any,{requireEntitlement:jest.fn()} as any,{get:()=> 'true'} as any);
  const t:any={organizationId:'org',userId:'actor',roleId:'client-role',role:'consulta',permissions:[P.DOCUMENTS_REPORTS_VIEW]};
  const before=JSON.stringify(body),result:any=await service.list(t);
  expect(result.currentPlanning[0].state).toBe('AVAILABLE');expect(result.currentPlanning[0].forecast.actual.find((a:any)=>a.month==='2026-01').consumptionKwh).toBe('105223.661700');expect(result.rows[0].actual.find((a:any)=>a.month==='2026-01').consumptionKwh).toBe('100000');expect(JSON.stringify(body)).toBe(before);expect(JSON.stringify(result.currentPlanning)).not.toMatch(/validatedBy|evidence|expansions|jan-publication|customerId/);
  revoked=true;await expect(service.list(t)).rejects.toThrow('revogado');
 });
