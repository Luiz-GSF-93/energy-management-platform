import {CceeDataService} from './ccee-data.service';
import {CceeDataWorker} from './ccee-data.worker';
import {CCEE_DATA_FLAGS,CCEE_DATA_PERMISSIONS,calendarSource,cceeMonth,readingCommand} from './ccee-data.model';
import {privateEnvelope,measurementRows,privateSoap,quantityMicro,CceePrivateConnector} from './ccee-private.connector';
import {calendarMapping,mappedCalendar,downloadCalendar} from './ccee-calendar';
import {workbookGrid} from './ccee-calendar.worker';
import * as XLSX from 'xlsx';
const id='10000000-0000-4000-8000-000000000001';
const context:any={scope:'organization',organizationId:'org',userId:id,role:'gestor',permissions:Object.values(CCEE_DATA_PERMISSIONS)};
function xml(rows:string,ns='http://xmlns.energia.org.br/BM/v1'){
 return `<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" xmlns:b="${ns}" xmlns:o="http://xmlns.energia.org.br/BO/v1"><s:Body><b:listarMedidaResponse><b:medidas>${rows}</b:medidas></b:listarMedidaResponse></s:Body></s:Envelope>`;
}
function hour(end='2026-09-01T01:00:00-03:00',value='1.25',unit='KWh',status='HCC',point='POINT'){
 return `<b:medida><o:periodo><o:fim>${end}</o:fim></o:periodo><o:pontoMedicao><o:codigo>${point}</o:codigo></o:pontoMedicao><o:consumoAtivo>${value}</o:consumoAtivo><o:consumoReativo>9.0</o:consumoReativo><o:unidade><o:codigo>${unit}</o:codigo></o:unidade><o:status>${status}</o:status></b:medida>`;
}
describe('CCEE R1 closed preparation boundaries',()=>{
 let env:NodeJS.ProcessEnv;beforeEach(()=>{env={...process.env};for(const f of CCEE_DATA_FLAGS)delete process.env[f];});afterEach(()=>{process.env=env;});
 it('does not claim availability or touch the database/network when disabled',async()=>{
  const rpc=jest.fn(),license={requireEntitlement:jest.fn()},s=new CceeDataService({getClient:()=>({rpc})}as any,license as any);
  expect(await s.workspace(context)).toMatchObject({enabled:false,bindings:[],jobs:[]});expect(rpc).not.toHaveBeenCalled();
  await expect(s.enqueue(context,{requestId:id,kind:'PLD',month:'2021-01'})).rejects.toThrow('desligada');
  const connector={execute:jest.fn()};await new CceeDataWorker({getClient:()=>({rpc})}as any,connector as any).runOnce();expect(connector.execute).not.toHaveBeenCalled();expect(rpc).not.toHaveBeenCalled();
 });
 it.each(['cliente','financeiro','support'])('rejects a non-backoffice role %s',async role=>{
  const s=new CceeDataService({}as any,{requireEntitlement:jest.fn()}as any);await expect(s.workspace({...context,role})).rejects.toThrow();
 });
 it('rejects global and revoked permissions before the RPC',async()=>{
  const s=new CceeDataService({}as any,{requireEntitlement:jest.fn()}as any);
  await expect(s.workspace({...context,scope:'global'})).rejects.toThrow();await expect(s.workspace({...context,permissions:[]})).rejects.toThrow();
 });
 it('rejects unlicensed access',async()=>{
  const rpc=jest.fn(),s=new CceeDataService({getClient:()=>({rpc})}as any,{requireEntitlement:jest.fn().mockRejectedValue(Error('license'))}as any);
  await expect(s.workspace(context)).rejects.toThrow('license');expect(rpc).not.toHaveBeenCalled();
 });
 it('never permits caller-selected endpoints, tenants, environments or open months',()=>{
  expect(()=>readingCommand({requestId:id,kind:'MEASUREMENTS',month:'2021-01',authorizationId:id,measurementKind:'FINAL',environment:'PILOT'})).toThrow();
  expect(()=>readingCommand({requestId:id,kind:'PLD',month:'2021-01',organizationId:'foreign'})).toThrow();expect(()=>cceeMonth('2099-01')).toThrow();
  expect(()=>readingCommand({requestId:id,kind:'PLD',month:'2021-01',authorizationId:id})).toThrow();
 });
 it('does not touch a queued private job while its gate is disabled',async()=>{
  process.env.CCEE_DATA_WORKSPACE_ENABLED='true';process.env.CCEE_SYNC_WORKER_ENABLED='true';
  const rpc=jest.fn().mockResolvedValue({data:null}),worker=new CceeDataWorker({getClient:()=>({rpc})}as any,{execute:jest.fn()}as any);
  await worker.runOnce();expect(rpc).toHaveBeenCalledWith('ccee_claim_reading',{p_private:false});
 });
 it('records bounded failure and discards private results after access changes',async()=>{
  process.env.CCEE_DATA_WORKSPACE_ENABLED='true';process.env.CCEE_SYNC_WORKER_ENABLED='true';process.env.CCEE_PRIVATE_READ_ENABLED='true';
  const job={id,organization_id:'org',kind:'MEASUREMENTS',lease_id:id},rpc=jest.fn(async(name:string)=>name==='ccee_claim_reading'?{data:job}:name==='ccee_assert_reading'?{error:{code:'42501'}}:{data:{recorded:true}});
  const connector={execute:jest.fn(async(_j:any,check:any)=>{await check();return{private:'not stored'};})};
  await new CceeDataWorker({getClient:()=>({rpc})}as any,connector as any).runOnce();
  expect(rpc).toHaveBeenLastCalledWith('ccee_finish_reading',{p_id:id,p_lease:id,p_result:null,p_error:'ACCESS_CHANGED'});
 });
 it('validates business namespaces and rejects XML entities and duplicate elements',()=>{
  expect(()=>privateEnvelope(xml(hour(),'https://attacker.invalid'),1,'listarMedidaResponse')).toThrow();
  expect(()=>privateEnvelope('<!DOCTYPE x>'+xml(hour()),1,'listarMedidaResponse')).toThrow();
  expect(()=>privateEnvelope(xml(hour().replace('</o:consumoAtivo>','</o:consumoAtivo><o:consumoAtivo>2</o:consumoAtivo>')),1,'listarMedidaResponse')).toThrow();
 });
 it('retains source reactivity separately, sums active units exactly and detects gaps',()=>{
  const p=measurementRows(xml(hour()),'POINT','2026-09-01T00:00:00-03:00','2026-09-01T01:00:00-03:00');
  expect(p.complete).toBe(true);expect(p.totalKwh).toBe('1.250000');expect(p.data[0].reactiveSource).toBe('9.0');
  expect(quantityMicro('0.125','MWh')).toBe(125000000n);expect(()=>quantityMicro('1',null)).toThrow();
  expect(measurementRows(xml(hour()),'POINT','2026-09-01T00:00:00-03:00','2026-09-01T02:00:00-03:00').complete).toBe(false);
 });
 it('does not accept estimated or unitless hours as complete',()=>{
  for(const row of [hour(undefined,undefined,'',undefined),hour(undefined,undefined,undefined,'HEC')])expect(measurementRows(xml(row),'POINT','2026-09-01T00:00:00-03:00','2026-09-01T01:00:00-03:00').complete).toBe(false);
 });
 it('rejects duplicate timestamps and foreign measurement points',()=>{
  for(const rows of [hour()+hour(),hour(undefined,undefined,undefined,undefined,'OTHER')])expect(()=>measurementRows(xml(rows),'POINT','2026-09-01T00:00:00-03:00','2026-09-01T01:00:00-03:00')).toThrow();
 });
 it('builds only documented read operations and escapes credentials',()=>{
  const c:any={profile:'1',username:'1',password:'<secret>',pfx:Buffer.alloc(0)};
  const p=privateSoap(c,'MEASUREMENTS','POINT','FINAL','2026-09-01T00:00:00-03:00','2026-09-02T00:00:00-03:00',null);
  expect(p).toContain('&lt;secret&gt;');expect(p).toContain('<bm:tipoMedida>FINAL</bm:tipoMedida>');expect(p).toContain('http://xmlns.energia.org.br/BM/v1');expect(p).not.toContain('listarPerfilParticipanteMercadoRequest');
  expect(()=>privateSoap(c,'MEASUREMENTS','POINT','FALTANTES','','',null)).toThrow();
 });
 it('does not let the private transport become an SSRF or write adapter',async()=>{
  const connector=new CceePrivateConnector({}as any);
  await expect(connector.fetch({}as any,'PRODUCTION','/admin/write','importarArquivo',Buffer.alloc(0))).rejects.toThrow('SERVICE_NOT_ALLOWED');
 });
 it('requires a canonical official calendar URL and bounds streamed bytes',async()=>{
  for(const u of ['https://evil.invalid/documents/1','https://www.ccee.org.br@evil.invalid/documents/1','http://www.ccee.org.br/documents/1','https://www.ccee.org.br/documents/1?token=x'])expect(()=>calendarSource(u)).toThrow();
  const transport=jest.fn().mockResolvedValue(new Response(new Uint8Array(5242881)));
  await expect(downloadCalendar('https://www.ccee.org.br/documents/1',transport)).rejects.toThrow();expect(transport.mock.calls[0][1].redirect).toBe('error');
 });
 it('parses only cached cells, rejects 1904 dates and does not execute formulas',()=>{
  const b=XLSX.utils.book_new(),s=XLSX.utils.aoa_to_sheet([['Value'],[2]]);s.A2={t:'n',v:2,f:'1+1'};XLSX.utils.book_append_sheet(b,s,'S');
  expect(workbookGrid(XLSX.write(b,{type:'buffer',bookType:'xlsx'}))[0].rows[1][0]).toBe(2);
  b.Workbook={WBProps:{date1904:true}};expect(()=>workbookGrid(XLSX.write(b,{type:'buffer',bookType:'xlsx'}))).toThrow('DATE_SYSTEM');
 });
 it('quarantines ambiguous calendar rows instead of assuming a deadline',()=>{
  const mapping=calendarMapping({sheet:'S',firstRow:1,titleColumn:1,dateColumn:2,monthColumn:3,applicabilityColumn:4,year:2026});
  expect(mappedCalendar([{name:'S',rows:[['Atividade','2026-09-01','2026-09','Consumidores']]}],mapping).complete).toBe(false);
  const result=mappedCalendar([{name:'S',rows:[['Atividade','2026-09-01T18:00:00-03:00','2026-09','Consumidores']]}],mapping);
  expect(result.complete).toBe(true);expect(result.items[0].dueAt).toBe('2026-09-01T18:00:00-03:00');
  expect(()=>calendarMapping({...mapping,dateColumn:1})).toThrow();
 });
});
