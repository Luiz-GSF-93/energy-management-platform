import {driCells,driCommand,driEnabled,driPage,driSoap} from './ccee-dri.model';
import {CceeDriConnector,driFaultTransaction} from './ccee-dri.connector';
import {XMLParser} from 'fast-xml-parser';
import {CceeDriService} from './ccee-dri.service';
import {CceeDataWorker} from './ccee-data.worker';
import {CceeReadingError} from './ccee-private.connector';
const uuid='10000000-0000-4000-8000-000000000001',month='2026-09';
const config:any={profile:'222',username:'1',password:'PRIVATE_PASSWORD',pfx:Buffer.alloc(0),passphrase:''};
const selection:any={kind:'DRI_EVENTS',month};
const wrap=(op:string,body:string,total=1,page=1,pages=1)=>`<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" xmlns:m="http://xmlns.energia.org.br/MH/v2" xmlns:b="http://xmlns.energia.org.br/BM/v2" xmlns:o="http://xmlns.energia.org.br/BO/v2"><s:Header><m:messageHeader><m:transactionId>${uuid}</m:transactionId></m:messageHeader><m:paginacao><m:numero>${page}</m:numero><m:totalPaginas>${pages}</m:totalPaginas><m:quantidadeTotalItens>${total}</m:quantidadeTotalItens></m:paginacao></s:Header><s:Body><b:${op}Response>${body}</b:${op}Response></s:Body></s:Envelope>`;
const events=(code='202609001000',ref=month)=>wrap('listarDivulgacaoEventoContabil',`<b:resultadoDivulgacaoEventoContabil><o:divulgacaoEventoContabil><o:eventoContabil><o:codigo>${code}</o:codigo><o:nome>Evento sintético</o:nome><o:periodoReferencia><o:mesAno>${ref}</o:mesAno></o:periodoReferencia></o:eventoContabil></o:divulgacaoEventoContabil></b:resultadoDivulgacaoEventoContabil>`);
const result=(tax='11111111000111',report='8',value="'11111111000111','-123.31',''",columns="'CNPJ DO AGENTE','AJUSTES (R$)','OUTRO'")=>wrap('listarResultadoRelatorio',`<b:resultados><o:resultadoRelatorio><o:cabecalho>${columns}</o:cabecalho><o:relatorio><o:id>${report}</o:id><o:quadros><o:quadro><o:id>31</o:id></o:quadro></o:quadros></o:relatorio><o:valores><o:valor>${value.replace('11111111000111',tax)}</o:valor></o:valores></o:resultadoRelatorio></b:resultados>`);
describe('CCEE DRI private read-only adapter',()=>{
 it('uses fixed service actions and the reviewed participant code, never the profile as CODIGO_AGENTE',()=>{
  const s=driSoap(config,{kind:'DRI_RESULTS',month,eventCode:'202609001000',reportId:'8',frameId:'31'},'111',['CODIGO_AGENTE','CODIGO_EVENTO_CONTABIL'],1);
  expect(s).toContain('<mh:codigoPerfilAgente>222</mh:codigoPerfilAgente>');expect(s).toContain('<bo:nome>CODIGO_AGENTE</bo:nome><bo:valor>111</bo:valor>');expect(s).not.toContain('listarPerfilParticipanteMercadoRequest');expect(s).toContain('<mh:quantidadeItens>500</mh:quantidadeItens>');
 });
 it.each([['CODIGO_EVENTO_CONTABIL'],['CODIGO_AGENTE','OUTRO'],['CODIGO_AGENTE','CODIGO_AGENTE']])('rejects unsupported or unscoped parameters %j',(...parameters)=>{expect(()=>driSoap(config,{kind:'DRI_RESULTS',month,eventCode:'1',reportId:'8',frameId:'31'},'111',parameters,1)).toThrow('DRI_PARAMETERS_REQUIRE_REVIEW');});
 it('requires parent selections and rejects arbitrary fields/endpoints',()=>{expect(driCommand({requestId:uuid,authorizationId:uuid,kind:'DRI_EVENTS',month}).kind).toBe('DRI_EVENTS');for(const patch of [{kind:'IMPORT_CONTRACT'},{url:'https://evil.invalid'},{eventCode:'1'},{kind:'DRI_REPORTS'}])expect(()=>driCommand({requestId:uuid,authorizationId:uuid,kind:'DRI_EVENTS',month,...patch})).toThrow();});
 it('validates events against the requested month',()=>{expect(driPage(events(),selection,1,'11111111000111').rows).toMatchObject([{code:'202609001000',name:'Evento sintético',month,providerOccurrences:1}]);expect(()=>driPage(events('202608001000','2026-08'),selection,1,'11111111000111')).toThrow('DRI_PERIOD_MISMATCH');});
 it('preserves blank cells and signed values without calculating or implying payment',()=>{const p=driPage(result(),{kind:'DRI_RESULTS',month,reportId:'8',frameId:'31'},1,'11111111000111');expect(p.rows[0]).toMatchObject({cells:['11111111000111','-123.31',''],scope:'PARTICIPANT',financialState:'UNMAPPED_REVIEW_REQUIRED'});});
 it('reads the official open-ended catalog shape while rejecting malformed or inverted dates',()=>{
  const catalog=(end:string)=>wrap('listarRelatorio',`<b:relatorios><o:relatorio><o:id>8</o:id><o:nome>SUM001</o:nome><o:periodo><o:inicio>2020-01-01T00:00:00-03:00</o:inicio>${end}</o:periodo><o:quadros><o:quadro><o:id>31</o:id><o:nome>Q3</o:nome><o:parametros><o:parametro><o:nome>CODIGO_AGENTE</o:nome></o:parametro></o:parametros></o:quadro></o:quadros></o:relatorio></b:relatorios>`);
  const s:any={kind:'DRI_REPORTS',month,eventCode:'202609001000'};
  expect(driPage(catalog(''),s,1,'11111111000111').rows[0].period).toEqual({start:'2020-01-01T00:00:00-03:00',end:null});
  expect(driPage(catalog('<o:fim>2027-01-01T00:00:00-03:00</o:fim>'),s,1,'11111111000111').rows[0].period.end).toBe('2027-01-01T00:00:00-03:00');
  for(const end of ['bad','2019-01-01T00:00:00-03:00'])expect(()=>driPage(catalog(`<o:fim>${end}</o:fim>`),s,1,'11111111000111')).toThrow('DRI_CATALOG_REQUIRES_REVIEW');
  expect(()=>driPage(catalog('').replace('<o:inicio>2020-01-01T00:00:00-03:00</o:inicio>',''),s,1,'11111111000111')).toThrow();
 });
 it.each([['22222222000122','8','DRI_PARTICIPANT_MISMATCH'],['11111111000111','9','DRI_REPORT_MISMATCH']])('rejects another participant/report', (tax,report,error)=>{expect(()=>driPage(result(tax,report),{kind:'DRI_RESULTS',month,reportId:'8',frameId:'31'},1,'11111111000111')).toThrow(error);});
 it('refuses results without participant evidence or with a changed row shape',()=>{for(const xml of [result('11111111000111','8',"'1','2'"),result('11111111000111','8',"'1'","'TOTAL'")])expect(()=>driPage(xml,{kind:'DRI_RESULTS',month,reportId:'8',frameId:'31'},1,'11111111000111')).toThrow();});
 it('supports quoted commas/escaped quotes but rejects malformed CSV and oversized cells',()=>{expect(driCells("'a,b','c''d',''")).toEqual(['a,b',"c'd",'']);for(const value of ['a,b',"'a',","'not closed", "'"+'x'.repeat(4001)+"'"])expect(()=>driCells(value)).toThrow();});
 it('rejects XXE, wrong namespaces, missing pagination and repeated scalar values',()=>{for(const xml of ['<!DOCTYPE s [<!ENTITY x SYSTEM "file:///secret">]>'+events(),events().replace('http://xmlns.energia.org.br/BO/v2','https://evil.invalid'),events().replace('<m:totalPaginas>1</m:totalPaginas>',''),events().replace('<o:codigo>202609001000</o:codigo>','<o:codigo>1</o:codigo><o:codigo>2</o:codigo>')])expect(()=>driPage(xml,selection,1,'11111111000111')).toThrow();});
 it('leaves all DRI routes disabled before accessing RPC/provider',async()=>{const prior=process.env.CCEE_DRI_READ_ENABLED;delete process.env.CCEE_DRI_READ_ENABLED;try{const rpc=jest.fn(),s=new CceeDriService({rpc}as any);await expect(s.enqueue({}as any,{})).rejects.toThrow();expect(rpc).not.toHaveBeenCalled();expect(()=>driEnabled()).toThrow();}finally{if(prior===undefined)delete process.env.CCEE_DRI_READ_ENABLED;else process.env.CCEE_DRI_READ_ENABLED=prior;}});
 it('collects a complete catalog without provider data in metrics and clears secrets',async()=>{
  const old={...process.env};process.env.CCEE_DRI_READ_ENABLED='true';const spy=jest.spyOn(require('./ccee-config'),'cceeConfig').mockReturnValue(config);
  try{const c=new CceeDriConnector();c.fetch=jest.fn(async()=>({xml:events(),bytes:100,httpStatus:200}));const check=jest.fn(async()=>{});const r=await c.execute({kind:'DRI_EVENTS',month:month+'-01',environment:'PRODUCTION',binding:{profile_code:'222',dri_agent_code:'111',dri_tax_id:'11111111000111'},request_payload:selection},check);expect(r.complete).toBe(true);expect(r.requests).toBe(1);expect(check).toHaveBeenCalledTimes(3);expect(JSON.stringify(r)).not.toContain('PRIVATE_PASSWORD');expect(r).not.toHaveProperty('record');}finally{spy.mockRestore();process.env=old;}
 });
 it('stops after the first invalid response, without retries or partial financial data',async()=>{
  const old={...process.env};process.env.CCEE_DRI_READ_ENABLED='true';const spy=jest.spyOn(require('./ccee-config'),'cceeConfig').mockReturnValue(config);
  try{const c=new CceeDriConnector();c.fetch=jest.fn(async()=>({xml:events('1','2026-08'),bytes:100,httpStatus:200}));await expect(c.execute({kind:'DRI_EVENTS',month:month+'-01',environment:'PRODUCTION',binding:{profile_code:'222',dri_agent_code:'111',dri_tax_id:'11111111000111'},request_payload:selection},async()=>{})).rejects.toMatchObject({code:'DRI_PERIOD_MISMATCH',metrics:{requests:1,httpStatus:200}});expect(c.fetch).toHaveBeenCalledTimes(1);}finally{spy.mockRestore();process.env=old;}
 });
 it('never claims DRI while its gate is off',async()=>{const old={...process.env};Object.assign(process.env,{CCEE_DATA_WORKSPACE_ENABLED:'true',CCEE_SYNC_WORKER_ENABLED:'true',CCEE_DRI_READ_ENABLED:'false'});try{const rpc=jest.fn(async(_name:string,_args?:unknown)=>({data:null}));await new CceeDataWorker({getClient:()=>({rpc})}as any,{}as any,{}as any).runOnce();expect(rpc).toHaveBeenCalledTimes(1);expect(rpc.mock.calls[0][0]).toBe('ccee_claim_reading');}finally{process.env=old;}});
 it('keeps rejection HTTP status in bounded audit metrics without retrying or persisting response text',async()=>{
  const old={...process.env};process.env.CCEE_DRI_READ_ENABLED='true';const spy=jest.spyOn(require('./ccee-config'),'cceeConfig').mockReturnValue(config);
  try{const c=new CceeDriConnector();c.fetch=jest.fn(async()=>{throw new CceeReadingError('PROVIDER_REJECTED',403);});await expect(c.execute({kind:'DRI_EVENTS',month:month+'-01',environment:'PRODUCTION',binding:{profile_code:'222',dri_agent_code:'111',dri_tax_id:'11111111000111'},request_payload:selection},async()=>{})).rejects.toMatchObject({code:'PROVIDER_REJECTED',metrics:{requests:1,httpStatus:403}});expect(c.fetch).toHaveBeenCalledTimes(1);}finally{spy.mockRestore();process.env=old;}
 });
 it('caps provider calls before the next page and never returns a partial catalog as complete',async()=>{
  const old={...process.env};Object.assign(process.env,{CCEE_DRI_READ_ENABLED:'true',CCEE_DRI_MAX_REQUESTS_PER_JOB:'1'});const spy=jest.spyOn(require('./ccee-config'),'cceeConfig').mockReturnValue(config);
  try{const c=new CceeDriConnector();c.fetch=jest.fn(async()=>({xml:events().replace('<m:totalPaginas>1</m:totalPaginas>','<m:totalPaginas>2</m:totalPaginas>').replace('<m:quantidadeTotalItens>1</m:quantidadeTotalItens>','<m:quantidadeTotalItens>2</m:quantidadeTotalItens>'),bytes:100,httpStatus:200}));const job={kind:'DRI_EVENTS',month:month+'-01',environment:'PRODUCTION',binding:{profile_code:'222',dri_agent_code:'111',dri_tax_id:'11111111000111'},request_payload:selection};await expect(c.execute(job,async()=>{})).rejects.toMatchObject({code:'RUN_TIME_LIMIT',metrics:{requests:1}});expect(c.fetch).toHaveBeenCalledTimes(1);process.env.CCEE_DRI_MAX_REQUESTS_PER_JOB='11';await expect(c.execute(job,async()=>{})).rejects.toMatchObject({code:'DRI_REQUEST_LIMIT_INVALID'});expect(c.fetch).toHaveBeenCalledTimes(1);}finally{spy.mockRestore();process.env=old;}
 });
});

describe('CCEE 00455384 duplicate implicit event regression',()=>{
 it.each(['448','451'])('sends the event once and only CODIGO_AGENTE in frame %s',frameId=>{
  for(const parameters of [['CODIGO_AGENTE','CODIGO_EVENTO_CONTABIL'],['CODIGO_AGENTE'],['CODIGO_EVENTO_CONTABIL','CODIGO_AGENTE']]){
   const xml=driSoap({...config,profile:'109583'},{kind:'DRI_RESULTS',month:'2026-03',eventCode:'202603001000',reportId:'114',frameId},'112642',parameters,1);
   const parsed=new XMLParser({removeNSPrefix:true,parseTagValue:false}).parse(xml),request=parsed.Envelope.Body.listarResultadoRelatorioRequest;
   expect(request.eventoContabil).toEqual({codigo:'202603001000'});
   expect(request.quadro).toEqual({id:frameId,parametros:{parametro:{nome:'CODIGO_AGENTE',valor:'112642'}}});
   expect(request.relatorio).toEqual({id:'114'});expect(xml.match(/202603001000/g)).toHaveLength(1);expect(xml).not.toContain('<bo:nome>CODIGO_EVENTO_CONTABIL</bo:nome>');
   expect(parsed.Envelope.Header.messageHeader.codigoPerfilAgente).toBe('109583');expect(parsed.Envelope.Header.paginacao.quantidadeItens).toBe('500');
  }
 });
 it('extracts only an unambiguous bounded transaction UUID from an error',()=>{
  const xml='<f:transactionId>'+uuid+'</f:transactionId>';
  expect(driFaultTransaction(xml)).toBe(uuid);expect(driFaultTransaction(xml+xml)).toBe(uuid);expect(driFaultTransaction('<transactionId>PRIVATE_PASSWORD</transactionId>')).toBeNull();
  expect(driFaultTransaction(xml+'<transactionId>20000000-0000-4000-8000-000000000002</transactionId>')).toBeNull();expect(driFaultTransaction('HTTP error')).toBeNull();
 });
 it('preserves HTTP and transaction provenance without retaining the fault text',async()=>{
  const old={...process.env};process.env.CCEE_DRI_READ_ENABLED='true';const spy=jest.spyOn(require('./ccee-config'),'cceeConfig').mockReturnValue(config);
  try{const c=new CceeDriConnector();c.fetch=jest.fn(async()=>{const error=new CceeReadingError('PROVIDER_REJECTED',500,uuid);error.responseBytes=123;throw error;});
   await expect(c.execute({kind:'DRI_EVENTS',month:month+'-01',environment:'PRODUCTION',binding:{profile_code:'222',dri_agent_code:'111',dri_tax_id:'11111111000111'},request_payload:selection},async()=>{})).rejects.toMatchObject({code:'PROVIDER_REJECTED',metrics:{requests:1,bytes:123,httpStatus:500,transactions:[uuid]}});expect(c.fetch).toHaveBeenCalledTimes(1);
  }finally{spy.mockRestore();process.env=old;}
 });
});
