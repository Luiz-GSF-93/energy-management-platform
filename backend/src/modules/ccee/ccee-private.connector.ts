import {Injectable} from '@nestjs/common';
import {request} from 'node:https';
import {createHash} from 'node:crypto';
import {XMLParser,XMLValidator} from 'fast-xml-parser';
import {cceeConfig,CceeConfig,soapRequest,xmlEscape} from './ccee-config';
import {CceeService} from './ccee.service';
import {CceeReadingJob,ReadingResult} from './ccee-data.model';
const SOAP='http://schemas.xmlsoap.org/soap/envelope/';
const uri=(family:string,v:number)=>`http://xmlns.energia.org.br/${family}/v${v}`;
const list=(v:any):any[]=>v==null||v===''?[]:Array.isArray(v)?v:[v];
export class CceeReadingError extends Error{
 metrics?:{requests:number;bytes:number;durationMs:number;hashes:string[];transactions:string[];httpStatus:number|null};
 responseBytes=0;
 constructor(public readonly code:string,public readonly httpStatus:number|null=null,public readonly transactionId:string|null=null){super(code);}
}
// Validate namespaces before removing prefixes. Never use the provider's text as a local error.
export function privateEnvelope(xml:string,version:number,operation:string,repeated:readonly string[]=[]){
 if(Buffer.byteLength(xml)>2097152||/<!DOCTYPE|<!ENTITY/i.test(xml)||XMLValidator.validate(xml)!==true)throw new CceeReadingError('INVALID_XML');
 const parsed=new XMLParser({ignoreAttributes:false,parseTagValue:false,processEntities:false,trimValues:true}).parse(xml);
 function child(parent:any,name:string,namespace:string,scope:Record<string,string>){
  const keys=Object.keys(parent??{}).filter(k=>!k.startsWith('@_')&&k.split(':').pop()===name);
  if(keys.length!==1)throw new CceeReadingError('INVALID_NAMESPACE');
  const key=keys[0],node=parent[key];if(Array.isArray(node))throw new CceeReadingError('INVALID_NAMESPACE');
  const ns={...scope};for(const [k,v]of Object.entries(node??{}))if(k==='@_xmlns')ns['']=String(v);else if(k.startsWith('@_xmlns:'))ns[k.slice(8)]=String(v);
  if(ns[key.includes(':')?key.split(':')[0]:'']!==namespace)throw new CceeReadingError('INVALID_NAMESPACE');return{node,ns};
 }
 const envelope=child(parsed,'Envelope',SOAP,{}),body=child(envelope.node,'Body',SOAP,envelope.ns);
 if(Object.keys(body.node??{}).some(k=>k.split(':').pop()==='Fault'))throw new CceeReadingError('SOAP_FAULT',200,xml.match(/<(?:\w+:)?transactionId>\s*([a-f0-9-]{36})\s*<\//i)?.[1]??null);
 const response=child(body.node,operation,uri('BM',version),body.ns);
 function strip(node:any,scope:Record<string,string>,depth=0):any{
  if(depth>25)throw new CceeReadingError('INVALID_XML');if(Array.isArray(node))return node.map(v=>strip(v,scope,depth+1));
  if(!node||typeof node!=='object')return node;
  const ns={...scope};for(const [k,v]of Object.entries(node))if(k==='@_xmlns')ns['']=String(v);else if(k.startsWith('@_xmlns:'))ns[k.slice(8)]=String(v);
  const out:Record<string,any>={};
  for(const[k,v]of Object.entries(node)){
   if(k.startsWith('@_'))continue;const name=k.split(':').pop()!;
   if(name==='__proto__'||name==='constructor'||name==='prototype'||Object.prototype.hasOwnProperty.call(out,name))throw new CceeReadingError('INVALID_XML');
   const sample=Array.isArray(v)?v[0]:v,local={...ns};
   for(const[a,b]of Object.entries(sample??{}))if(a==='@_xmlns')local['']=String(b);else if(a.startsWith('@_xmlns:'))local[a.slice(8)]=String(b);
   if(![uri('BM',version),uri('BO',version),uri('MH',version)].includes(local[k.includes(':')?k.split(':')[0]:'']))throw new CceeReadingError('INVALID_NAMESPACE');
   if(Array.isArray(v)&&!['medida','pontoMedicao','medidor','participanteMercadoRelacionado','perfil','tipo',...repeated].includes(name))throw new CceeReadingError('DUPLICATE_SCALAR');
   out[name]=strip(v,local,depth+1);
  }return out;
 }
 let transactionId:string|null=null,pagination:any=null;
 if(Object.keys(envelope.node).some(k=>k.split(':').pop()==='Header')){
  const header=child(envelope.node,'Header',SOAP,envelope.ns);
  for(const key of Object.keys(header.node??{})){
   if(key.split(':').pop()==='messageHeader'){const h=child(header.node,'messageHeader',uri('MH',version),header.ns);const id=strip(h.node,h.ns).transactionId;if(typeof id==='string'&&/^[a-f0-9-]{36}$/i.test(id))transactionId=id;}
   if(key.split(':').pop()==='paginacao'){const p=child(header.node,'paginacao',uri('MH',version),header.ns);pagination=strip(p.node,p.ns);}
  }
 }
 return{body:strip(response.node,response.ns),pagination,transactionId,hash:createHash('sha256').update(xml).digest('hex')};
}
// Integers scaled to millionths avoid summation drift. Units must be stated by the source.
export function quantityMicro(value:unknown,unit:unknown):bigint{
 if(typeof value!=='string'||!/^\d{1,15}(\.\d{1,6})?$/.test(value)||!['KWh','kWh','MWh'].includes(String(unit)))throw new CceeReadingError('MEASUREMENT_UNIT_OR_VALUE_MISSING');
 const[a,b='']=value.split('.');return(BigInt(a)*1000000n+BigInt(b.padEnd(6,'0')))*(unit==='MWh'?1000n:1n);
}
const decimal=(n:bigint)=>(n/1000000n).toString()+'.'+(n%1000000n).toString().padStart(6,'0');
export const CCEE_HOURLY_TIME_SEMANTICS='CCEE_HOUR_LABEL_V2';
// CCEE support 00450944: periodo/fim is an hour label (00..23), not an interval end.
export function measurementWindow(start:string,end:string,kind='FINAL'){
 const valid=(v:string)=>/^20\d{2}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}-03:00$/.test(v)&&Number.isFinite(Date.parse(v))&&new Date(Date.parse(v)-10800000).toISOString().slice(0,19)+'-03:00'===v;
 if(!valid(start)||!valid(end)||!start.includes(':00:00-03:00')||!['FINAL','CONSOLIDADA','FALTANTES'].includes(kind)||Date.parse(end)<Date.parse(start))throw new CceeReadingError('INVALID_MEASUREMENT_WINDOW');
 const first=Date.parse(start),last=Date.parse(end),exclusive=kind==='CONSOLIDADA';
 const expectedHours=exclusive?Math.ceil((last-first)/3600000):Math.floor((last-first)/3600000)+1;
 if(expectedHours<1||expectedHours>744)throw new CceeReadingError('INVALID_MEASUREMENT_WINDOW');
 return {first,last,exclusive,expectedHours};
}
export function measurementRows(xml:string,point:string,start:string,end:string,diagnostics=false,kind='FINAL'){
 const window=measurementWindow(start,end,kind);
 const parsed=privateEnvelope(xml,1,'listarMedidaResponse'),rows=list(parsed.body?.medidas?.medida);
 if(rows.length>744)throw new CceeReadingError('MEASUREMENT_LIMIT');
 const seen=new Set<number>();let total=0n;const observations:string[]=[];
 const data=rows.map(r=>{
  const stamp=String(r.periodo?.fim??''),at=Date.parse(stamp);
  const fail=(code:string)=>{throw new CceeReadingError(diagnostics?code:'MEASUREMENT_INTERVAL_OR_POINT_MISMATCH');};
  if(typeof r.pontoMedicao?.codigo!=='string'||!r.pontoMedicao.codigo)fail('MEASUREMENT_POINT_MISSING');
  if(r.pontoMedicao?.codigo!==point)fail('MEASUREMENT_POINT_MISMATCH');
  if(!stamp)fail('MEASUREMENT_TIMESTAMP_MISSING');
  if(!/^\d{4}-\d{2}-\d{2}T\d{2}:00:00(?:-03:00|Z)$/.test(stamp)||!Number.isFinite(at))fail('MEASUREMENT_TIMESTAMP_FORMAT');
  if(at<window.first||(window.exclusive?at>=window.last:at>window.last))fail('MEASUREMENT_INTERVAL_MISMATCH');
  if(seen.has(at))fail('MEASUREMENT_DUPLICATE_TIMESTAMP');
  seen.add(at);let quantityKwh:string|null=null;
  try{const n=quantityMicro(r.consumoAtivo,r.unidade?.codigo);quantityKwh=decimal(n);total+=n;}catch{observations.push('Quantidade ou unidade nÃ£o demonstrada em '+stamp);}
  if(r.status!=='HCC')observations.push('Qualidade '+String(r.status??'nÃ£o informada')+' em '+stamp);
  // Reactive values are preserved as source values, never added to active energy.
  return{hourLabel:stamp,end:stamp,quantityKwh,unit:r.unidade?.codigo??null,status:r.status??null,reactiveSource:r.consumoReativo??null,subType:r.subTipo??null};
 });
 const expected=window.expectedHours;
 if(rows.length!==expected)observations.push('Cobertura horÃ¡ria incompleta.');
 return{...parsed,timeSemantics:CCEE_HOURLY_TIME_SEMANTICS,data,totalKwh:decimal(total),observations,complete:observations.length===0,expectedHours:expected};
}
export function privateSoap(config:CceeConfig,kind:'POINTS'|'MEASUREMENTS',point:string,measurementKind:string,start:string,end:string,meter:string|null,page=1){
 const base=soapRequest(config,'profile',page);let body:string;
 if(kind==='POINTS')body='<bm:listarPontoMedicaoRequest><bm:tiposRelacoes>'+['AGENTE_CONECTADO','AGENTE_CONECTANTE','AGENTE_MEDICAO','AGENTE_USO_FIO'].map(x=>'<bo:tipo><bo:nome>'+x+'</bo:nome></bo:tipo>').join('')+'</bm:tiposRelacoes></bm:listarPontoMedicaoRequest>';
 else{
  if(!['FINAL','CONSOLIDADA','FALTANTES'].includes(measurementKind)||!/^[-A-Za-z0-9_]{1,100}$/.test(point)||measurementKind==='FALTANTES'&&!/^[-A-Za-z0-9_]{1,100}$/.test(meter??''))throw new CceeReadingError('INVALID_MEASUREMENT_SELECTION');
  measurementWindow(start,end,measurementKind);
  body=`<bm:listarMedida><bm:${measurementKind==='FALTANTES'?'medidor':'pontoMedicao'}><bo:codigo>${xmlEscape(measurementKind==='FALTANTES'?meter!:point)}</bo:codigo></bm:${measurementKind==='FALTANTES'?'medidor':'pontoMedicao'}><bm:tipoMedida>${measurementKind}</bm:tipoMedida><bm:tipoMedicao>COLETA</bm:tipoMedicao><bm:periodo><bo:inicio>${start}</bo:inicio><bo:fim>${end}</bo:fim></bm:periodo></bm:listarMedida>`;
 }
 return base.replace(/<soapenv:Body>[\s\S]*?<\/soapenv:Body>/,'<soapenv:Body>'+body+'</soapenv:Body>').replace(/\/MH\/v2/g,kind==='POINTS'?'/MH/v2':'/MH/v1').replace(/\/BM\/v2/g,kind==='POINTS'?'/BM/v2':'/BM/v1').replace(/\/BO\/v2/g,kind==='POINTS'?'/BO/v2':'/BO/v1').replace('<mh:versao>2.1</mh:versao>','');
}
@Injectable()
export class CceePrivateConnector{
 constructor(private pld:CceeService){}
 async fetch(config:CceeConfig,environment:string,path:string,action:string,payload:Buffer):Promise<{xml:string;bytes:number;httpStatus:number}>{
  if(!['PRODUCTION','PILOT'].includes(environment)||!['/ws/v2/PontoMedicaoBSv2','/ws/medc/ListarMedidaBSv1'].includes(path)||!['listarPontoMedicao','listarMedida'].includes(action))throw new CceeReadingError('SERVICE_NOT_ALLOWED');
  return new Promise((resolve,reject)=>{
   let done=false,req:ReturnType<typeof request>|undefined;const finish=(e?:Error,v?:any)=>{if(done)return;done=true;clearTimeout(timer);e?reject(e):resolve(v);};
   const timer=setTimeout(()=>{req?.destroy();finish(new CceeReadingError('TIMEOUT'));},25000);
   try{req=request({hostname:environment==='PILOT'?'piloto-servicos.ccee.org.br':'servicos.ccee.org.br',port:443,path,method:'POST',agent:false,pfx:config.pfx,passphrase:config.passphrase,ca:config.ca,rejectUnauthorized:true,minVersion:'TLSv1.2',maxVersion:'TLSv1.2',headers:{'Content-Type':'text/xml; charset=utf-8',SOAPAction:action,'Content-Length':payload.length,Connection:'close'}},res=>{
    let bytes=0;const chunks:Buffer[]=[];
    res.on('data',(b:Buffer)=>{bytes+=b.length;if(bytes>2097152){req?.destroy();finish(new CceeReadingError('RESPONSE_LIMIT'));}else chunks.push(b);});
    res.on('aborted',()=>finish(new CceeReadingError('TRUNCATED_RESPONSE')));res.on('error',()=>finish(new CceeReadingError('TRANSPORT_ERROR')));
    res.on('end',()=>{
     const xml=Buffer.concat(chunks).toString('utf8');
     if(res.statusCode!==200||!/(?:text|application)\/xml/i.test(String(res.headers['content-type']??''))){
      // Only an opaque, bounded transaction identifier is taken from an error body.
      const id=xml.match(/<(?:\w+:)?transactionId>\s*([a-f0-9-]{36})\s*<\//i)?.[1]??null;
      const error=new CceeReadingError('PROVIDER_REJECTED',res.statusCode??null,id);error.responseBytes=bytes;finish(error);
     }else finish(undefined,{xml,bytes,httpStatus:200});
    });
   });req.on('error',()=>finish(new CceeReadingError('TRANSPORT_ERROR')));req.end(payload);}catch{finish(new CceeReadingError('TRANSPORT_ERROR'));}
  });
 }
 async execute(job:CceeReadingJob,revalidate:()=>Promise<void>):Promise<ReadingResult>{
  const began=Date.now();await revalidate();
  if(job.kind==='PLD'){
   if(job.environment!=='PRODUCTION'||job.organization_id!==process.env.CCEE_ORGANIZATION_ID)throw new CceeReadingError('PLD_ORGANIZATION_MISMATCH');
   let requests=0,bytes=0;
   try{const data=await this.pld.preview({month:job.month.slice(0,7)},{attempt:()=>{requests++;},response:n=>{bytes+=n;}});await revalidate();
    return{complete:true,requests,bytes,durationMs:Date.now()-began,hashes:data.sourceHashes,transactions:[],data};
   }catch(e){const error=e instanceof CceeReadingError?e:new CceeReadingError('PLD_READ_NOT_CONFIRMED');error.metrics={requests,bytes,durationMs:Date.now()-began,hashes:[],transactions:[],httpStatus:null};throw error;}
  }
  const binding=job.binding;if(!binding)throw new CceeReadingError('BINDING_REQUIRED');
  let config:CceeConfig|undefined;const result:ReadingResult={complete:true,requests:0,bytes:0,durationMs:0,hashes:[],transactions:[],data:{rows:[],observations:[]}};
  const diagnostics=process.env.CCEE_READING_DIAGNOSTICS_ENABLED==='true';let lastHttpStatus:number|null=null;
  try{
   config=cceeConfig(process.env);config={...config,profile:job.kind==='MEASUREMENTS'?binding.principal_profile_code:binding.profile_code};
   const month=job.month.slice(0,7),days=new Date(Date.UTC(Number(month.slice(0,4)),Number(month.slice(5,7)),0)).getUTCDate();
   let pages=1,totalPoints:number|null=null,total=0n;
   for(let index=1;index<=(job.kind==='POINTS'?pages:days);index++){
    if(Date.now()-began>120000)throw new CceeReadingError('RUN_TIME_LIMIT');await revalidate();
    const day=month+'-'+String(index).padStart(2,'0'),start=day+'T00:00:00-03:00',end=day+'T23:59:59-03:00';
    const payload=Buffer.from(privateSoap(config,job.kind,binding.measurement_point,job.measurement_kind??'FINAL',start,end,binding.meter_code,job.kind==='POINTS'?index:1));
    result.requests++;
    let response:{xml:string;bytes:number;httpStatus:number};try{response=await this.fetch(config,job.environment,job.kind==='POINTS'?'/ws/v2/PontoMedicaoBSv2':'/ws/medc/ListarMedidaBSv1',job.kind==='POINTS'?'listarPontoMedicao':'listarMedida',payload);}finally{payload.fill(0);}
    result.bytes+=response.bytes;lastHttpStatus=response.httpStatus;
    // Capture only bounded provenance before row validation; never retain a raw provider body.
    if(diagnostics){result.hashes.push(createHash('sha256').update(response.xml).digest('hex'));}
    const envelope=diagnostics?privateEnvelope(response.xml,job.kind==='POINTS'?2:1,job.kind==='POINTS'?'listarPontoMedicaoResponse':'listarMedidaResponse'):null;
    if(envelope?.transactionId)result.transactions.push(envelope.transactionId);
    if(job.kind==='POINTS'){
     const p=privateEnvelope(response.xml,2,'listarPontoMedicaoResponse'),pg=p.pagination;
     if(!pg||Number(pg.numero)!==index||!Number.isInteger(Number(pg.totalPaginas))||Number(pg.totalPaginas)<1||Number(pg.totalPaginas)>20||!Number.isInteger(Number(pg.quantidadeTotalItens))||Number(pg.quantidadeTotalItens)<0||Number(pg.quantidadeTotalItens)>1000||index>1&&(pages!==Number(pg.totalPaginas)||totalPoints!==Number(pg.quantidadeTotalItens)))throw new CceeReadingError('PAGINATION_CHANGED_OR_LIMIT');
     pages=Number(pg.totalPaginas);totalPoints=Number(pg.quantidadeTotalItens);
     result.data.rows.push(...list(p.body?.pontosMedicao?.pontoMedicao));if(!diagnostics){result.hashes.push(p.hash);if(p.transactionId)result.transactions.push(p.transactionId);}
    }else if(job.measurement_kind==='FALTANTES'){
     const p=privateEnvelope(response.xml,1,'listarMedidaResponse');result.complete=false;
     const rows=list(p.body?.medidas?.medida);if(rows.length>744)throw new CceeReadingError('MEASUREMENT_LIMIT');
     if(rows.some(r=>r.pontoMedicao?.codigo&&r.pontoMedicao.codigo!==binding.measurement_point||r.medidor?.codigo&&r.medidor.codigo!==binding.meter_code||!r.pontoMedicao?.codigo&&!r.medidor?.codigo))throw new CceeReadingError('MEASUREMENT_INTERVAL_OR_POINT_MISMATCH');
     const seen=new Set<number>();
     for(const row of rows){
      const stamp=String(row.periodo?.fim??''),at=Date.parse(stamp);
      if(!Number.isFinite(at)||!/(?:-03:00|Z)$/.test(stamp)||at<Date.parse(start)||at>Date.parse(end)||seen.has(at))throw new CceeReadingError('MEASUREMENT_INTERVAL_OR_POINT_MISMATCH');
      seen.add(at);
     }
     result.data.rows.push(...rows);if(!diagnostics){result.hashes.push(p.hash);if(p.transactionId)result.transactions.push(p.transactionId);}
    }else{
     const p=measurementRows(response.xml,binding.measurement_point,start,end,diagnostics,job.measurement_kind??'FINAL');result.complete&&=p.complete;result.data.rows.push(...p.data);result.data.observations.push(...p.observations);total+=quantityMicro(p.totalKwh,'kWh');if(!diagnostics){result.hashes.push(p.hash);if(p.transactionId)result.transactions.push(p.transactionId);}
    }
   }
   if(job.kind==='POINTS'&&(result.data.rows.length!==totalPoints||new Set(result.data.rows.map((r:any)=>r.codigo)).size!==totalPoints))throw new CceeReadingError('INCOMPLETE_POINTS');
   if(job.kind==='POINTS'){result.data.rows=result.data.rows.filter((r:any)=>r.codigo===binding.measurement_point);if(result.data.rows.length!==1)throw new CceeReadingError('AUTHORIZED_POINT_NOT_FOUND');}
   if(job.kind==='MEASUREMENTS'&&job.measurement_kind!=='FALTANTES'){
    result.data.timeSemantics=CCEE_HOURLY_TIME_SEMANTICS;result.data.totalKwh=decimal(total);result.data.expectedHours=days*24;
    result.complete&&=result.data.rows.length===days*24;
    const hash=createHash('sha256').update(CCEE_HOURLY_TIME_SEMANTICS+':'+result.hashes.join(':')).digest('hex');
    result.record={schemaVersion:'ccee-record/1',kind:'CONSUMPTION',binding:{organizationId:job.organization_id,customerId:binding.customer_id,unitId:binding.consumer_unit_id,profileCode:binding.profile_code,measurementPoint:binding.measurement_point,authorizationId:binding.id,authorizationRevision:binding.revision},evidence:{provider:'CCEE',service:'ListarMedidaBSv1',externalId:binding.measurement_point+':'+month,revision:hash,month,retrievedAt:new Date().toISOString(),sourceHash:hash,finality:result.complete&&job.measurement_kind==='FINAL'?'FINAL':'PROVISIONAL'},lines:[{type:'CONSUMPTION',code:'CONSUMPTION_TOTAL',quantityKwh:decimal(total),timeBand:'ALL',includesLosses:binding.measurement_basis==='UNKNOWN'?null:binding.measurement_basis==='WITH_LOSSES'}]};
   }
   await revalidate();result.durationMs=Date.now()-began;return result;
  }catch(e){
   const error=e instanceof CceeReadingError?e:new CceeReadingError('READ_NOT_CONFIRMED');
   error.metrics={requests:result.requests,bytes:result.bytes+error.responseBytes,durationMs:Date.now()-began,hashes:result.hashes,transactions:[...result.transactions,...(error.transactionId?[error.transactionId]:[])],httpStatus:error.httpStatus??lastHttpStatus};throw error;
  }finally{config?.pfx.fill(0);}
 }
}
