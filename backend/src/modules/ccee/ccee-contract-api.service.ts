import {Body,Controller,Get,Header,Injectable,Logger,OnModuleDestroy,OnModuleInit,Param,Post,ServiceUnavailableException} from '@nestjs/common';
import {request} from 'node:https';
import {Tenant} from '../../common/decorators/tenant.decorator';
import {TenantContext} from '../../common/interfaces/tenant-context.interface';
import {SupabaseService} from '../../services/supabase.service';
import {CceeDataService} from './ccee-data.service';
import {cceeConfig,CceeConfig} from './ccee-config';
import {cceeMonth,cceeObject,cceeText,cceeUuid} from './ccee-data.model';
import {CceeReadingError} from './ccee-private.connector';
import {CONTRACT_SERVICES,contractHash,contractPage,contractQuery,contractSoap,preparedContractFile} from './ccee-contract-api.model';
import {driFaultTransaction} from './ccee-dri.connector';
@Injectable()
export class CceeContractApiService{
 constructor(private data:CceeDataService){}
 async action(t:TenantContext,action:string,id:string|null,body:unknown={}){
  if(id)cceeUuid(id);
  if(action==='create'){
   const b=body as any;
   if(b?.operation==='FILE'){
    cceeObject(b,['requestId','authorizationId','month','operation','role','environment','reason','confirmed','xml','layoutReference']);
    cceeUuid(b.requestId);cceeUuid(b.authorizationId);cceeMonth(b.month);cceeText(b.reason,1000,10);cceeText(b.layoutReference,1000,10);preparedContractFile(b.xml);
    if(b.environment!=='PILOT'||!['COMPRADOR','VENDEDOR'].includes(b.role)||b.confirmed!==true)throw new CceeReadingError('PILOT_FILE_CONFIRMATION_REQUIRED');
   }else{
    if(process.env.CCEE_CONTRACT_READ_ENABLED!=='true')throw new ServiceUnavailableException('Consulta de contratos aguarda ativação após testes.');
    contractQuery(body);body={...(body as any),environment:'PRODUCTION'};
   }
  }else if(action==='review'){
   const b=cceeObject(body,['requestId','revision','hash','reason']);cceeUuid(b.requestId);cceeText(b.reason,1000,10);
   if(!Number.isInteger(b.revision)||b.revision<1||typeof b.hash!=='string'||!/^[a-f0-9]{64}$/.test(b.hash))throw new CceeReadingError('EXACT_FILE_REVIEW_REQUIRED');
  }
  const value=await this.data.rpc('ccee_contract_action',{p_org:t.organizationId,p_actor:t.userId,p_action:action,p_id:id,p_body:body});
  return{...value,readEnabled:process.env.CCEE_CONTRACT_READ_ENABLED==='true',pilotTransmissionEnabled:false,productionTransmissionEnabled:false,notice:'Consultas ACL somente de leitura. Arquivos ficam preparados/revisados; aguardam validação XSD e homologação piloto antes de qualquer transmissão.'};
 }
}
@Controller('ccee-registrations/provider')
export class CceeContractApiController{
 constructor(private service:CceeContractApiService){}
 @Get() @Header('Cache-Control','private, no-store') list(@Tenant()t:TenantContext){return this.service.action(t,'list',null);}
 @Get(':id') @Header('Cache-Control','private, no-store') job(@Tenant()t:TenantContext,@Param('id')id:string){return this.service.action(t,'job',id);}
 @Get(':id/history') @Header('Cache-Control','private, no-store') history(@Tenant()t:TenantContext,@Param('id')id:string){return this.service.action(t,'history',id);}
 @Post() create(@Tenant()t:TenantContext,@Body()b:unknown){return this.service.action(t,'create',null,b);}
 @Post(':id/review') review(@Tenant()t:TenantContext,@Param('id')id:string,@Body()b:unknown){return this.service.action(t,'review',id,b);}
}
@Injectable()
export class CceeContractConnector{
 async fetch(c:CceeConfig,operation:'CONTRACTS'|'AMOUNTS',payload:Buffer):Promise<string>{
  const target=CONTRACT_SERVICES[operation];if(!target||!['CONTRACTS','AMOUNTS'].includes(operation))throw new CceeReadingError('SERVICE_NOT_ALLOWED');
  return new Promise((resolve,reject)=>{
   let req:ReturnType<typeof request>|undefined,done=false;const finish=(e?:Error,xml?:string)=>{if(done)return;done=true;clearTimeout(timer);e?reject(e):resolve(xml!);};
   const timer=setTimeout(()=>{req?.destroy();finish(new CceeReadingError('TIMEOUT'));},25000);
   try{req=request({hostname:'servicos.ccee.org.br',port:443,path:target.path,method:'POST',agent:false,pfx:c.pfx,passphrase:c.passphrase,ca:c.ca,rejectUnauthorized:true,minVersion:'TLSv1.2',maxVersion:'TLSv1.2',headers:{'Content-Type':'text/xml; charset=utf-8',SOAPAction:target.action,'Content-Length':payload.length,Connection:'close'}},res=>{
    let bytes=0;const chunks:Buffer[]=[];
    res.on('data',(b:Buffer)=>{bytes+=b.length;if(bytes>2097152){req?.destroy();finish(new CceeReadingError('RESPONSE_LIMIT'));}else chunks.push(b);});
    res.on('aborted',()=>finish(new CceeReadingError('TRUNCATED_RESPONSE')));res.on('error',()=>finish(new CceeReadingError('TRANSPORT_ERROR')));
    res.on('end',()=>{const xml=Buffer.concat(chunks).toString('utf8');if(res.statusCode!==200||!/(?:text|application)\/xml/i.test(String(res.headers['content-type']??''))){const error=new CceeReadingError('PROVIDER_REJECTED',res.statusCode??null,driFaultTransaction(xml));error.responseBytes=bytes;error.metrics={requests:0,bytes,durationMs:0,hashes:[contractHash(xml)],transactions:error.transactionId?[error.transactionId]:[],httpStatus:error.httpStatus};finish(error);}else finish(undefined,xml);});
   });req.on('error',()=>finish(new CceeReadingError('TRANSPORT_ERROR')));req.end(payload);}catch{finish(new CceeReadingError('TRANSPORT_ERROR'));}
  });
 }
 async collect(job:any,assert:()=>Promise<void>,reserve:()=>Promise<void>){
  let config:CceeConfig|undefined;const began=Date.now(),rows:any[]=[],hashes:string[]=[],transactions:string[]=[];let requests=0;
  const max=Number(process.env.CCEE_CONTRACT_MAX_REQUESTS_PER_JOB??'1');if(!Number.isInteger(max)||max<1||max>5)throw new CceeReadingError('REQUEST_LIMIT');
  try{
   await assert();config=cceeConfig(process.env);const c=job.command,b=job.binding;
   if(c.organization_id!==config.organizationId||c.environment!=='PRODUCTION'||b.organization_id!==c.organization_id||b.revision!==c.binding_revision||!['CONTRACTS','AMOUNTS'].includes(c.operation))throw new CceeReadingError('ACCESS_CHANGED');
   config.profile=b.profile_code;const q={...c.payload,month:c.month.slice(0,7)};let pages=1,total=-1;
   for(let page=1;page<=pages;page++){
    if(requests>=max||Date.now()-began>95000)throw new CceeReadingError('CONTRACT_PAGINATION_REQUIRES_CONTINUATION');
    await assert();const buffer=Buffer.from(contractSoap(config,q,page));let xml:string;
    try{await reserve();requests++;xml=await this.fetch(config,c.operation,buffer);}finally{buffer.fill(0);}
    const p=contractPage(xml,q,config.profile,page);if(page>1&&(p.pages!==pages||p.total!==total))throw new CceeReadingError('PAGINATION_CHANGED');pages=p.pages;total=p.total;
    rows.push(...p.rows);hashes.push(p.hash);if(p.transactionId)transactions.push(p.transactionId);
   }
   if(rows.length!==total||new Set(rows.map(r=>JSON.stringify(r))).size!==rows.length)throw new CceeReadingError('CONTRACT_COVERAGE_REVIEW');await assert();
   return{complete:true,rows,requests,hashes,transactions,sourceHash:contractHash(hashes.join(':')),profileCode:config.profile,month:q.month,operation:c.operation,financialState:'SOURCE_ONLY',durationMs:Date.now()-began};
  }catch(e){const error=e instanceof CceeReadingError?e:new CceeReadingError('CONTRACT_READ_UNCONFIRMED');error.metrics={requests,bytes:error.responseBytes??0,durationMs:Date.now()-began,hashes:[...hashes,...(error.metrics?.hashes??[])],transactions:[...transactions,...(error.transactionId?[error.transactionId]:[])],httpStatus:error.httpStatus};throw error;}
  finally{config?.pfx.fill(0);}
 }
}
@Injectable()
export class CceeContractApiWorker implements OnModuleInit,OnModuleDestroy{
 private timer?:ReturnType<typeof setTimeout>;private stopped=false;private busy=false;private log=new Logger(CceeContractApiWorker.name);
 constructor(private db:SupabaseService,private connector:CceeContractConnector){}
 private enabled(){return process.env.CCEE_CONTRACT_READ_ENABLED==='true'&&process.env.CCEE_DATA_WORKSPACE_ENABLED==='true'&&process.env.CCEE_SYNC_WORKER_ENABLED==='true';}
 onModuleInit(){if(this.enabled())this.schedule();}
 onModuleDestroy(){this.stopped=true;clearTimeout(this.timer);}
 private schedule(){if(this.stopped)return;this.timer=setTimeout(()=>{void this.runOnce().catch(()=>this.log.warn('CCEE_CONTRACT_STEP_UNCONFIRMED')).finally(()=>this.schedule());},30000);this.timer.unref?.();}
 async runOnce(){
  if(this.stopped||this.busy||!this.enabled())return;this.busy=true;
  try{const db=this.db.getClient(),claim=await db.rpc('ccee_contract_worker',{p_action:'claim'});if(claim.error)throw Error('CONTRACT_CLAIM_UNAVAILABLE');if(!claim.data)return;
   const job=claim.data,c=job.command;
   const rpc=async(action:string)=>{if(!this.enabled())throw new CceeReadingError('FUNCTION_DISABLED');const r=await db.rpc('ccee_contract_worker',{p_action:action,p_id:c.id,p_lease:c.lease_id});if(r.error)throw new CceeReadingError(action==='reserve'?'CONTRACT_BUDGET_OR_ACCESS_REVIEW':'ACCESS_CHANGED');return r.data;};
   let result:any=null,error:string|null=null,diagnostic:any=null;
   try{result=await this.connector.collect(job,()=>rpc('assert'),()=>rpc('reserve'));}catch(e){error=e instanceof CceeReadingError?e.code:'CONTRACT_READ_UNCONFIRMED';diagnostic=e instanceof CceeReadingError?e.metrics??null:null;}
   const finished=await db.rpc('ccee_contract_worker',{p_action:'finish',p_id:c.id,p_lease:c.lease_id,p_body:{result,error,diagnostic}});if(finished.error)throw Error('CONTRACT_FINISH_UNCONFIRMED');
  }finally{this.busy=false;}
 }
}
