import {Injectable} from '@nestjs/common';
import {request} from 'node:https';
import {cceeConfig,CceeConfig,CCEE_HOST} from './ccee-config';
import {CceeReadingError} from './ccee-private.connector';
import {DRI_SERVICES,DriKind,driSoap,driPage,driDigest,driEnabled,isDri} from './ccee-dri.model';
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
    res.on('end',()=>{if(res.statusCode!==200||!/(?:text|application)\/xml/i.test(String(res.headers['content-type']??'')))finish(new CceeReadingError('PROVIDER_REJECTED',res.statusCode??null));else finish(undefined,{xml:Buffer.concat(chunks).toString('utf8'),bytes,httpStatus:200});});
   });req.on('error',()=>finish(new CceeReadingError('TRANSPORT_ERROR')));req.end(payload);}catch{finish(new CceeReadingError('TRANSPORT_ERROR'));}
  });
 }
 async execute(job:any,revalidate:()=>Promise<void>){
  driEnabled();if(!isDri(job.kind)||job.environment!=='PRODUCTION'||!job.binding?.dri_agent_code||!job.binding?.dri_tax_id)throw new CceeReadingError('DRI_BINDING_REQUIRED');
  const began=Date.now(),hashes:string[]=[],transactions:string[]=[],rows:any[]=[];let config:CceeConfig|undefined,requests=0,bytes=0,httpStatus:number|null=null;
  try{
   await revalidate();config={...cceeConfig(process.env),profile:job.binding.profile_code};
   const selection={...job.request_payload,month:job.month.slice(0,7)};let pages=1,total:number|null=null;const seen=new Set<string>();
   for(let page=1;page<=pages;page++){
    driEnabled();if(Date.now()-began>95000||requests>=10)throw new CceeReadingError('RUN_TIME_LIMIT');await revalidate();
    const payload=Buffer.from(driSoap(config,selection,job.binding.dri_agent_code,job.dri_parameters??[],page));let response:{xml:string;bytes:number;httpStatus:number};
    requests++;try{response=await this.fetch(config,job.kind,payload);}finally{payload.fill(0);}
    bytes+=response.bytes;httpStatus=response.httpStatus;const p=driPage(response.xml,selection,page,job.binding.dri_tax_id);
    hashes.push(p.hash);if(p.transactionId)transactions.push(p.transactionId);
    if(page>1&&(pages!==p.pages||total!==p.total))throw new CceeReadingError('DRI_PAGINATION_CHANGED');pages=p.pages;total=p.total;
    for(const row of p.rows){const key=row.code??row.id??JSON.stringify(row);if(seen.has(key))throw new CceeReadingError('DRI_DUPLICATE_ROW');seen.add(key);rows.push(row);}
    if(Buffer.byteLength(JSON.stringify(rows))>1800000)throw new CceeReadingError('DRI_RESULT_LIMIT');
   }
   if(rows.length!==total)throw new CceeReadingError('DRI_COVERAGE_INCOMPLETE');await revalidate();
   return{complete:true,requests,bytes,durationMs:Date.now()-began,hashes,transactions,data:{kind:job.kind,month:selection.month,eventCode:selection.eventCode??null,reportId:selection.reportId??null,frameId:selection.frameId??null,participantCode:job.binding.dri_agent_code,participantTaxId:job.binding.dri_tax_id,scope:'PARTICIPANT',financialState:'UNMAPPED_REVIEW_REQUIRED',sourceHash:driDigest(hashes),rows}};
  }catch(e){const error=e instanceof CceeReadingError?e:new CceeReadingError('DRI_READ_NOT_CONFIRMED');error.metrics={requests,bytes,durationMs:Date.now()-began,hashes,transactions,httpStatus:error.httpStatus??httpStatus};throw error;}
  finally{config?.pfx.fill(0);}
 }
}
