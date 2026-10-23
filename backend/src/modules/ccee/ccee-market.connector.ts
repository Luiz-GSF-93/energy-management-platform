import {Injectable} from '@nestjs/common';
import {request} from 'node:https';
import {CceeConfig,cceeConfig,soapRequest,xmlEscape} from './ccee-config';
import {privateEnvelope,quantityMicro,CceeReadingError} from './ccee-private.connector';
import {parseCcee,pldHours,profilePresent} from './ccee-response';
import {marketDay,marketDigest} from './ccee-market.model';
const list=(v:any):any[]=>v==null?[]:Array.isArray(v)?v:[v];
const decimal=(n:bigint)=>(n/1000000n)+'.'+String(n%1000000n).padStart(6,'0');
export function fiveMinuteRequest(config:CceeConfig,day:string,meter:string,page:number){
 marketDay(day);if(!/^[-A-Za-z0-9_]{1,100}$/.test(meter)||!Number.isInteger(page)||page<1||page>10)throw Error('INVALID_MEASUREMENT_SELECTION');
 return soapRequest(config,'profile',1).replace(/<mh:versao>2.1<\/mh:versao>/,'').replace(/<mh:numero>1<\/mh:numero>/,'<mh:numero>'+page+'</mh:numero>').replace('<mh:quantidadeItens>2</mh:quantidadeItens>','<mh:quantidadeItens>100</mh:quantidadeItens>').replace(/<soapenv:Body>[\s\S]*?<\/soapenv:Body>/,`<soapenv:Body><bm:listarMedidaCincoMinutosRequest><bm:dataReferencia>${day}T00:00:00</bm:dataReferencia><bm:medidor><bo:codigo>${xmlEscape(meter)}</bo:codigo></bm:medidor></bm:listarMedidaCincoMinutosRequest></soapenv:Body>`);
}
export function fiveMinuteRows(xml:string,meter:string,day:string){
 marketDay(day);const parsed=privateEnvelope(xml,2,'listarMedidaCincoMinutosResponse'),first=Date.parse(day+'T00:00:00-03:00'),seen=new Set<string>();
 const energy=(node:any,unit:string)=>{if(node==null)return null;if(node.unidadeMedida!==unit)throw new CceeReadingError('MEASUREMENT_UNIT_OR_VALUE_MISSING');if(typeof node.valor!=='string'||!/^\d{1,15}(\.\d{1,6})?$/.test(node.valor))throw new CceeReadingError('MEASUREMENT_UNIT_OR_VALUE_MISSING');return unit==='kWh'?decimal(quantityMicro(node.valor,unit)):node.valor;};
 const rows=list(parsed.body?.medidas?.medida).map(r=>{
  const at=Date.parse(r.data),type=r.tipoEnergia?.codigo;
  if(r.medidor?.codigo!==meter||typeof r.data!=='string'||!/^20\d{2}-\d{2}-\d{2}T\d{2}:\d{2}:00(?:-03:00|Z)$/.test(r.data)||!Number.isFinite(at)||at<=first||at>first+86400000||(at-first)%300000!==0||typeof type!=='string'||!type||type.length>30)throw new CceeReadingError('MEASUREMENT_INTERVAL_OR_POINT_MISMATCH');
  const key=at+'|'+type;if(seen.has(key))throw new CceeReadingError('MEASUREMENT_DUPLICATE_TIMESTAMP');seen.add(key);
  return {at:new Date(at).toISOString(),meter,energyType:type,activeConsumptionKwh:energy(r.energiaAtiva?.consumo,'kWh'),activeGenerationKwh:energy(r.energiaAtiva?.geracao,'kWh'),reactiveConsumptionKvarh:energy(r.energiaReativa?.consumo,'kVArh'),reactiveGenerationKvarh:energy(r.energiaReativa?.geracao,'kVArh'),collection:r.coletaMedicao?.tipo?.nome??null};
 });
 return {...parsed,rows};
}
@Injectable()
export class CceeMarketConnector{
 async fetch(config:CceeConfig,kind:'PROFILE'|'PLD_HOURLY'|'MEASUREMENTS_5M',payload:Buffer):Promise<string>{
  const target={PROFILE:['/ws/v2/PerfilParticipanteMercadoBSv2','listarPerfilParticipanteMercado'],PLD_HOURLY:['/ws/prec/PLDBSv1','listarPLD'],MEASUREMENTS_5M:['/ws/v2/MedidaCincoMinutosBSv2','listarMedidaCincoMinutos']}[kind];
  if(!target)throw new CceeReadingError('SERVICE_NOT_ALLOWED');
  return new Promise((resolve,reject)=>{let req:ReturnType<typeof request>|undefined,done=false;const finish=(e?:Error,value?:string)=>{if(done)return;done=true;clearTimeout(timer);e?reject(e):resolve(value!);};const timer=setTimeout(()=>{req?.destroy();finish(new CceeReadingError('TIMEOUT'));},25000);
   try{req=request({hostname:'servicos.ccee.org.br',port:443,path:target[0],method:'POST',agent:false,pfx:config.pfx,passphrase:config.passphrase,ca:config.ca,rejectUnauthorized:true,minVersion:'TLSv1.2',maxVersion:'TLSv1.2',headers:{'Content-Type':'text/xml; charset=utf-8',SOAPAction:target[1],'Content-Length':payload.length,Connection:'close'}},res=>{
    if(res.statusCode!==200||!/(?:text|application)\/xml/i.test(String(res.headers['content-type']??''))){res.destroy();finish(new CceeReadingError('PROVIDER_REJECTED',res.statusCode??null));return;}
    let bytes=0;const chunks:Buffer[]=[];res.on('data',(b:Buffer)=>{bytes+=b.length;if(bytes>2097152){res.destroy();finish(new CceeReadingError('RESPONSE_LIMIT'));}else chunks.push(b);});res.on('aborted',()=>finish(new CceeReadingError('TRUNCATED_RESPONSE')));res.on('error',()=>finish(new CceeReadingError('TRANSPORT_ERROR')));res.on('end',()=>finish(undefined,Buffer.concat(chunks).toString('utf8')));
   });req.on('error',()=>finish(new CceeReadingError('TRANSPORT_ERROR')));req.end(payload);}catch{finish(new CceeReadingError('TRANSPORT_ERROR'));}
  });
 }
 async collect(job:{organizationId:string;kind:'PLD_HOURLY'|'MEASUREMENTS_5M';day:string;binding?:any;maxRequests:number},beforeRequest:()=>Promise<void>){
  marketDay(job.day);if(!Number.isInteger(job.maxRequests)||job.maxRequests<1||job.maxRequests>10)throw new CceeReadingError('REQUEST_LIMIT');
  let config:CceeConfig|undefined,requests=0;const began=Date.now(),hashes:string[]=[],transactions:string[]=[],rows:any[]=[];
  const read=async(kind:'PROFILE'|'PLD_HOURLY'|'MEASUREMENTS_5M',xml:string)=>{if(requests>=job.maxRequests||Date.now()-began>95000)throw new CceeReadingError('RUN_TIME_LIMIT');await beforeRequest();requests++;const payload=Buffer.from(xml);try{return await this.fetch(config!,kind,payload);}finally{payload.fill(0);}};
  try{
   config=cceeConfig(process.env);if(config.organizationId!==job.organizationId)throw new CceeReadingError('ACCESS_CHANGED');
   if(job.kind==='MEASUREMENTS_5M'){if(!job.binding?.principal_profile_code||!job.binding?.meter_code)throw new CceeReadingError('METER_AND_PRINCIPAL_PROFILE_REQUIRED');config.profile=job.binding.principal_profile_code;}
   const proof=parseCcee(await read('PROFILE',soapRequest(config,'profile',1)),'profile',1);if(!profilePresent(proof.body,config.profile))throw new CceeReadingError('CCEE_PROFILE_NOT_CONFIRMED');
   let pages=1,total=-1;
   for(let page=1;page<=pages;page++){
    const payload=job.kind==='PLD_HOURLY'?soapRequest(config,'pld',page,job.day.slice(0,7)).replace(/<bo:inicio>[^<]+<\/bo:inicio>/,`<bo:inicio>${job.day}T00:00:00</bo:inicio>`).replace(/<bo:fim>[^<]+<\/bo:fim>/,`<bo:fim>${job.day}T00:00:00</bo:fim>`):fiveMinuteRequest(config,job.day,job.binding.meter_code,page);
    const xml=await read(job.kind,payload),parsed=job.kind==='PLD_HOURLY'?parseCcee(xml,'pld',page):fiveMinuteRows(xml,job.binding.meter_code,job.day);
    const pg=job.kind==='PLD_HOURLY'?{numero:page,totalPaginas:(parsed as any).pages,quantidadeTotalItens:(parsed as any).total}:(parsed as any).pagination;
    const next=Number(pg?.totalPaginas),count=Number(pg?.quantidadeTotalItens);
    if(Number(pg?.numero)!==page||!Number.isInteger(next)||next<1||next>9||!Number.isInteger(count)||count<0||count>2000||page>1&&(pages!==next||total!==count))throw new CceeReadingError('PAGINATION_CHANGED_OR_LIMIT');pages=next;total=count;hashes.push(parsed.hash);if((parsed as any).transactionId)transactions.push((parsed as any).transactionId);
    rows.push(...(job.kind==='PLD_HOURLY'?pldHours(parsed.body,job.day.slice(0,7)):(parsed as any).rows));
   }
   if(rows.length!==(job.kind==='PLD_HOURLY'?total*4:total))throw new CceeReadingError('INCOMPLETE_PAGINATION');
   const start=Date.parse(job.day+'T00:00:00-03:00'),seen=new Set<string>();for(const r of rows){const key=job.kind==='PLD_HOURLY'?r.start+'|'+r.submarket:r.at+'|'+r.energyType;if(seen.has(key))throw new CceeReadingError('MEASUREMENT_DUPLICATE_TIMESTAMP');seen.add(key);if(job.kind==='PLD_HOURLY'&&(Date.parse(r.start)<start||Date.parse(r.start)>=start+86400000))throw new CceeReadingError('MEASUREMENT_INTERVAL_OR_POINT_MISMATCH');}
   return {kind:job.kind,day:job.day,requests,hashes,transactions,sourceHash:marketDigest(rows),rows,complete:job.kind==='PLD_HOURLY'?rows.length===96:rows.length>0&&rows.every(r=>r.activeConsumptionKwh!==null||r.activeGenerationKwh!==null)&&[...new Set(rows.map(r=>r.energyType))].every(type=>rows.filter(r=>r.energyType===type).length===288),retrievedAt:new Date().toISOString(),durationMs:Date.now()-began};
  }finally{config?.pfx.fill(0);}
 }
}
