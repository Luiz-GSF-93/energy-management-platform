import {Injectable} from '@nestjs/common';
import {request} from 'node:https';
import {createHash} from 'node:crypto';
import {cceeConfig,CceeConfig,CCEE_HOST} from './ccee-config';
import {CceeReadingError} from './ccee-private.connector';
import {DRI_SERVICES,DriKind,driSoap,driPage,driDigest,driEnabled,isDri} from './ccee-dri.model';
export function driFaultTransaction(xml:string){
 const ids=[...xml.matchAll(/<(?:[A-Za-z_][\w.-]*:)?transactionId>\s*([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})\s*<\//gi)].map(m=>m[1]);
 return new Set(ids).size===1?ids[0]:null;
}
@Injectable()
export class CceeDriConnector{
 async fetch(config:CceeConfig,kind:DriKind,payload:Buffer):Promise<{xml:string;bytes:number;httpStatus:number}>{
  if(!isDri(kind))throw new CceeReadingError('SERVICE_NOT_ALLOWED');
  const service=DRI_SERVICES[kind];
  return new Promise((resolve,reject)=>{let done=false;let req:ReturnType<typeof request>|undefined;
   const finish=(error?:Error,value?:any)=>{if(done)return;done=true;clearTimeout(timer);error?reject(error):resolve(value);};
   const timer=setTimeout(()=>{req?.destroy();finish(new CceeReadingError('TIMEOUT'));},25000);
   try{req=request({hostname:CCEE_HOST,port:443,path:service.path,method:'POST',agent:false,pfx:config.pfx,passphrase:config.passphrase,ca:config.ca,rejectUnauthorized:true,minVersion:'TLSv1.2',maxVersion:'TLSv1.2',headers:{'Content-Type':'text/xml; charset=utf-8',SOAPAction:service.action,'Content-Length':payload.length,Connection:'close'}},res=>{
    let bytes=0;const chunks:Buffer[]=[];res.on('data',(b:Buffer)=>{bytes+=b.length;if(bytes>2097152){req?.destroy();finish(new CceeReadingError('RESPONSE_LIMIT'));}else chunks.push(b);});
    res.on('aborted',()=>finish(new CceeReadingError('TRUNCATED_RESPONSE')));res.on('error',()=>finish(new CceeReadingError('TRANSPORT_ERROR')));
    res.on('end',()=>{const xml=Buffer.concat(chunks).toString('utf8');if(res.statusCode!==200||!/(?:text|application)\/xml/i.test(String(res.headers['content-type']??''))){const error=new CceeReadingError('PROVIDER_REJECTED',res.statusCode??null,driFaultTransaction(xml));error.responseBytes=bytes;finish(error);}else finish(undefined,{xml,bytes,httpStatus:200});});
   });req.on('error',()=>finish(new CceeReadingError('TRANSPORT_ERROR')));req.end(payload);}catch{finish(new CceeReadingError('TRANSPORT_ERROR'));}
  });
 }
 async execute(job:any,revalidate:()=>Promise<void>,reserveRequest?:()=>Promise<void>){
  driEnabled();if(!isDri(job.kind)||job.environment!=='PRODUCTION'||!job.binding?.dri_agent_code||!job.binding?.dri_tax_id)throw new CceeReadingError('DRI_BINDING_REQUIRED');
  const maxRequests=Number(process.env.CCEE_DRI_MAX_REQUESTS_PER_JOB??'10');
  if(!Number.isInteger(maxRequests)||maxRequests<1||maxRequests>10)throw new CceeReadingError('DRI_REQUEST_LIMIT_INVALID');
  const began=Date.now(),hashes:string[]=[],transactions:string[]=[],rows:any[]=[];let config:CceeConfig|undefined,requests=0,bytes=0,httpStatus:number|null=null;
  try{
   await revalidate();config={...cceeConfig(process.env),profile:job.binding.profile_code};
   const selection={...job.request_payload,month:job.month.slice(0,7)};let pages=1,total:number|null=null;const seen=new Map<string,any>();let providerRows=0;
   for(let page=1;page<=pages;page++){
    driEnabled();if(Date.now()-began>95000||requests>=maxRequests)throw new CceeReadingError('RUN_TIME_LIMIT');await revalidate();
    const payload=Buffer.from(driSoap(config,selection,job.binding.dri_agent_code,job.dri_parameters??[],page));let response:{xml:string;bytes:number;httpStatus:number};
    try{await reserveRequest?.();requests++;response=await this.fetch(config,job.kind,payload);}finally{payload.fill(0);}
    bytes+=response.bytes;httpStatus=response.httpStatus;hashes.push(createHash('sha256').update(response.xml).digest('hex'));const transaction=driFaultTransaction(response.xml);if(transaction&&!transactions.includes(transaction))transactions.push(transaction);
    const p=driPage(response.xml,selection,page,job.binding.dri_tax_id);providerRows+=p.providerRows;
    if(page>1&&(pages!==p.pages||total!==p.total))throw new CceeReadingError('DRI_PAGINATION_CHANGED');pages=p.pages;total=p.total;
    for(const row of p.rows){const key=row.code??row.id??JSON.stringify(row),previous=seen.get(key);if(previous){if(job.kind!=='DRI_EVENTS')throw new CceeReadingError('DRI_DUPLICATE_ROW');if(previous.sourceIdentity!==row.sourceIdentity)throw new CceeReadingError('DRI_EVENT_IDENTITY_CONFLICT');previous.providerOccurrences+=row.providerOccurrences;}else{seen.set(key,row);rows.push(row);}}
    if(Buffer.byteLength(JSON.stringify(rows))>1800000)throw new CceeReadingError('DRI_RESULT_LIMIT');
   }
   if(providerRows!==total)throw new CceeReadingError('DRI_COVERAGE_INCOMPLETE');await revalidate();
   return{complete:true,requests,bytes,durationMs:Date.now()-began,hashes,transactions,data:{kind:job.kind,month:selection.month,eventCode:selection.eventCode??null,reportId:selection.reportId??null,frameId:selection.frameId??null,participantCode:job.binding.dri_agent_code,participantTaxId:job.binding.dri_tax_id,scope:'PARTICIPANT',financialState:'UNMAPPED_REVIEW_REQUIRED',sourceHash:driDigest(hashes),providerRows,uniqueRows:rows.length,repeatedRows:providerRows-rows.length,rows}};
  }catch(e){const error=e instanceof CceeReadingError?e:new CceeReadingError('DRI_READ_NOT_CONFIRMED');error.metrics={requests,bytes:bytes+error.responseBytes,durationMs:Date.now()-began,hashes,transactions:[...transactions,...(error.transactionId?[error.transactionId]:[])],httpStatus:error.httpStatus??httpStatus};throw error;}
  finally{config?.pfx.fill(0);}
 }
}
