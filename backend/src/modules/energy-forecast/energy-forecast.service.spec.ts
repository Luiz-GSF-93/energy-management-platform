import {EnergyForecastService} from './energy-forecast.service';
import {reportHash} from '../reports/report.projection';
import {PERMISSIONS as P} from '../../common/constants/permissions';
import {loadNasaTemperature} from './nasa-power';
jest.mock('./nasa-power',()=>({loadNasaTemperature:jest.fn()}));
describe('isolated auditable forecast service',()=>{
 const customer='00000000-0000-4000-8000-000000000001',unit='00000000-0000-4000-8000-000000000002',history='00000000-0000-4000-8000-000000000003',requestId='00000000-0000-4000-8000-000000000004';
 const t:any={organizationId:'test-org',userId:'test-actor',roleId:'test-role',role:'gestor',permissions:[P.DOCUMENTS_REPORTS_VIEW,P.ORGANIZATION_CONTRACTS_VIEW,P.DOCUMENTS_REPORTS_CREATE,P.DOCUMENTS_VIEW,P.DOCUMENTS_UPDATE]};
 const source:any={organizationId:t.organizationId,customerId:customer,unitId:unit,historyId:history,evidenceId:history,reviewedBy:'test-reviewer',reviewedAt:'2026-09-01T00:00:00Z',history:{sourceDocumentId:'test-invoice',rows:Array.from({length:12},(_,i)=>({month:new Date(Date.UTC(2025,8+i,1)).toISOString().slice(0,7),consumptionKwh:'3000',days:30,page:1,source:'test-table'}))},documents:[{id:'test-invoice',version:1,fileHash:'a'.repeat(64)}]};
 const input={requestId,customerId:customer,unitId:unit,asOfMonth:'2026-08',sources:[{historyId:history}],expansions:[]};
 let enabled:boolean,rpc:jest.Mock,service:EnergyForecastService,prior:any;
 beforeEach(()=>{
  enabled=true;prior=null;jest.clearAllMocks();
  rpc=jest.fn(async(name:string,p:any)=>({error:null,data:name==='energy_forecast_request'?prior:name==='energy_forecast_history_source'?source:name==='energy_forecast_histories'?[]:name==='energy_forecast_prepare'?{id:'test-run',organization_id:p.p_org,customer_id:customer,consumer_unit_id:unit,payload_hash:p.p_hash,body:p.p_body,request:p.p_request,created_by:t.userId,events:[]}:null}));
  service=new EnergyForecastService({getClient:()=>({rpc})} as any,{requireEntitlement:jest.fn().mockResolvedValue({})} as any,{get:(k:string)=>k==='ENERGY_FORECAST_ENABLED'?(enabled?'true':'false'):''} as any,{} as any);
 });
 it('does not touch database while disabled',async()=>{enabled=false;await expect(service.prepare(input,t)).rejects.toThrow('habilitação');expect(rpc).not.toHaveBeenCalled();});
 it('supports independently reviewed invoice histories without ACL permission',async()=>{const r=await service.prepare(input,t);expect(r.body.future).toHaveLength(4);expect(r.body.status).toBe('PRELIMINARY');expect(r.body.weatherApplied).toBe(false);expect(rpc.mock.calls.some(([n])=>n.startsWith('acl_'))).toBe(false);});
 it('lists independent histories even without ACL access',async()=>{await expect(service.sources(t)).resolves.toEqual([]);expect(rpc.mock.calls.some(([n])=>n.startsWith('acl_'))).toBe(false);});
 it('rejects organization injection and unknown fields',async()=>{await expect(service.prepare({...input,organizationId:'other'},t)).rejects.toThrow();expect(rpc.mock.calls.some(([n])=>n==='energy_forecast_prepare')).toBe(false);});
 it('rejects ambiguous source types',async()=>{await expect(service.prepare({...input,sources:[{historyId:history,admissionId:requestId,evidenceId:requestId}]},t)).rejects.toThrow('fontes válidas');});
 it('blocks sources from another unit',async()=>{const old=source.unitId;source.unitId='foreign';try{await expect(service.prepare(input,t)).rejects.toThrow('Histórico');}finally{source.unitId=old;}});
 it('requires document access for source processing',async()=>{await expect(service.prepare(input,{...t,permissions:t.permissions.filter((p:string)=>p!==P.DOCUMENTS_VIEW)})).rejects.toThrow('documentos');});
 it('never refreshes an existing request snapshot',async()=>{const r=await service.prepare(input,t);prior=r;rpc.mockClear();expect(await service.prepare(input,t)).toEqual(r);expect(rpc.mock.calls.some(([n])=>n==='energy_forecast_history_source')).toBe(false);expect(loadNasaTemperature).not.toHaveBeenCalled();});
 it('does not reuse a request with a changed premise',async()=>{prior=await service.prepare(input,t);await expect(service.prepare({...input,asOfMonth:'2026-07'},t)).rejects.toThrow('Requisição');});
 it('never queries weather without location consent',async()=>{await expect(service.prepare({...input,weather:{latitude:-23.5,longitude:-46.5,consent:false}},t)).rejects.toThrow('Autorize');expect(loadNasaTemperature).not.toHaveBeenCalled();});
 it('preserves weather failure as unavailable rather than zero',async()=>{(loadNasaTemperature as jest.Mock).mockRejectedValueOnce(Error('unavailable'));const r=await service.prepare({...input,weather:{latitude:-23.5,longitude:-46.5,consent:true}},t);expect(r.body.weather).toBeNull();expect(r.body.weatherStatus).toBe('UNAVAILABLE');expect(r.body.weatherApplied).toBe(false);expect(r.payload_hash).toBe(reportHash(r.body));});
 it('persists climate calibration as a new preliminary hashed snapshot',async()=>{
  const originalRows=source.history.rows;
  const temperatures=[21,29,19,25,16,20,14,27,24,18,28,22];
  const rows=Array.from({length:36},(_,i)=>{const date=new Date(Date.UTC(2023,8+i,1)),month=date.toISOString().slice(0,7),m=date.getUTCMonth(),days=new Date(Date.UTC(date.getUTCFullYear(),m+1,0)).getUTCDate();return {month,days,consumptionKwh:((100+i*0.8+10*Math.sin(m*Math.PI/6)+3*temperatures[m])*days).toFixed(6),page:1,source:'test-table'};});
  source.history.rows=rows;
  (loadNasaTemperature as jest.Mock).mockResolvedValueOnce({provider:'NASA_POWER',parameter:'T2M',unit:'°C',timeStandard:'UTC',sourceHash:'b'.repeat(64),from:'2023-09-01',to:'2026-08-31',monthly:rows.map(r=>({month:r.month,temperatureC:temperatures[Number(r.month.slice(5))-1],validDays:r.days,expectedDays:r.days}))});
  try{const run=await service.prepare({...input,weather:{latitude:-23.5,longitude:-46.5,consent:true}},t);expect(run.body.weatherApplied).toBe(true);expect(run.body.weatherStatus).toBe('CLIMATE_SCENARIO_APPLIED');expect(run.body.status).toBe('PRELIMINARY');expect(run.body.climateAssessment.comparison.predictions).toBe(21);expect(run.payload_hash).toBe(reportHash(run.body));expect(run.events).toEqual([]);prior=run;await expect(service.prepare({...input,weather:{latitude:-23.5,longitude:-46.5,consent:true}},t)).resolves.toEqual(run);expect(loadNasaTemperature).toHaveBeenCalledTimes(1);}finally{source.history.rows=originalRows;}
 });
 it('persists all approved sources but calculates and requests weather for only the latest 36 months',async()=>{
  const allRows=Array.from({length:44},(_,i)=>({month:new Date(Date.UTC(2023,i,1)).toISOString().slice(0,7),consumptionKwh:'3000',days:30,page:1,source:'test-table'}));
  const older={...source,historyId:requestId,evidenceId:requestId,history:{...source.history,rows:allRows.slice(0,12)}};
  const newer={...source,history:{...source.history,rows:allRows.slice(12)}};
  const previous=rpc.getMockImplementation()!;
  rpc.mockImplementation(async(name,p)=>name==='energy_forecast_history_source'?{error:null,data:p.p_history===history?newer:older}:previous(name,p));
  (loadNasaTemperature as jest.Mock).mockRejectedValueOnce(Error('unavailable'));
  const d={...input,sources:[{historyId:requestId},{historyId:history}],weather:{latitude:-23.5,longitude:-46.5,consent:true}};
  const run=await service.prepare(d,t),write=rpc.mock.calls.find(([n])=>n==='energy_forecast_prepare')![1];
  expect(write.p_sources.map((s:any)=>s.history.rows.length)).toEqual([12,32]);expect(run.body.historyWindow).toMatchObject({availableMonths:44,selectedMonths:36,from:'2023-09',to:'2026-08'});
  expect(run.body.historyWindow.excludedMonths).toHaveLength(8);expect(run.body.qualifications.join(' ')).toContain('36 de 44');expect(run.payload_hash).toBe(reportHash(run.body));
  expect(loadNasaTemperature).toHaveBeenCalledWith(d.weather,'2023-09-01','2026-08-31');
  prior=run;rpc.mockClear();await expect(service.prepare(d,t)).resolves.toEqual(run);expect(rpc.mock.calls.some(([n])=>n==='energy_forecast_history_source')).toBe(false);
 });
 it('rejects source conflicts even in months outside the calculation window',async()=>{
  const rows=Array.from({length:44},(_,i)=>({month:new Date(Date.UTC(2023,i,1)).toISOString().slice(0,7),consumptionKwh:'3000',days:30,page:1,source:'test-table'}));
  const older={...source,historyId:requestId,evidenceId:requestId,history:{...source.history,rows:rows.slice(0,12)}};
  const conflict={...older,historyId:unit,evidenceId:unit,history:{...older.history,rows:rows.slice(0,12).map((r,i)=>i===0?{...r,consumptionKwh:'4000'}:r)}};
  const newer={...source,history:{...source.history,rows:rows.slice(12)}};
  const previous=rpc.getMockImplementation()!;rpc.mockImplementation(async(name,p)=>name==='energy_forecast_history_source'?{error:null,data:p.p_history===history?newer:p.p_history===unit?conflict:older}:previous(name,p));
  await expect(service.prepare({...input,sources:[{historyId:requestId},{historyId:history},{historyId:unit}]},t)).rejects.toThrow('Histórico');expect(rpc.mock.calls.some(([n])=>n==='energy_forecast_prepare')).toBe(false);
 });
 it('operator can prepare but cannot validate or publish',async()=>{await expect(service.transition(requestId,{requestId,payloadHash:'a'.repeat(64),action:'VALIDATED',note:'Conferência documental do histórico.'},{...t,role:'operacional'})).rejects.toThrow('Gestor');expect(rpc.mock.calls.some(([n])=>n==='energy_forecast_transition')).toBe(false);});
 it('returns no forecast to existing reports while disabled',async()=>{enabled=false;await expect(service.publishedForReport(customer,unit,'2026-08',t)).resolves.toBeNull();expect(rpc).not.toHaveBeenCalled();});
 it('exports only a recipient-safe published projection',async()=>{const run=await service.prepare(input,t);run.version=1;run.events=[{action:'PUBLISHED',created_at:'2026-09-02T00:00:00Z'}];rpc.mockImplementation(async name=>({error:null,data:name==='energy_forecast_published'?run:null}));const projection=await service.publishedForReport(customer,unit,'2026-08',t);expect(projection!.actual[0].evidence).toBeUndefined();expect(projection!.actual[0].consumptionKwh).toBe('3000.000000');expect(projection).not.toHaveProperty('sources');expect(projection).not.toHaveProperty('expansions');expect(projection).not.toHaveProperty('weather');});
 it('blocks a published forecast from another cut',async()=>{const run=await service.prepare(input,t);run.events=[{action:'PUBLISHED',created_at:'2026-09-02T00:00:00Z'}];rpc.mockImplementation(async name=>({error:null,data:name==='energy_forecast_published'?run:null}));await expect(service.publishedForReport(customer,unit,'2026-07',t)).rejects.toThrow('Recorte');});
});
