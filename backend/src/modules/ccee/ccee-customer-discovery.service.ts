import {Body,Controller,Get,Header,Injectable,Logger,OnModuleDestroy,OnModuleInit,Post,Query} from '@nestjs/common';
import {Tenant} from '../../common/decorators/tenant.decorator';
import {TenantContext} from '../../common/interfaces/tenant-context.interface';
import {SupabaseService} from '../../services/supabase.service';
import {CceeDataService} from './ccee-data.service';
import {CceeMarketConnector} from './ccee-market.connector';
import {cceeConfig,CceeConfig} from './ccee-config';
import {cceeObject,cceeText,cceeUuid,cceeDataEnabled} from './ccee-data.model';
import {CceeReadingError} from './ccee-private.connector';
import {participantConclusion,participantPage,participantRequest} from './ccee-customer-discovery.model';
@Injectable()
export class CceeCustomerDiscoveryService implements OnModuleInit,OnModuleDestroy{
 private timer?:ReturnType<typeof setTimeout>;private stopped=false;private busy=false;private log=new Logger(CceeCustomerDiscoveryService.name);
 constructor(private db:SupabaseService,private data:CceeDataService,private transport:CceeMarketConnector){}
 private enabled(){return process.env.CCEE_DATA_WORKSPACE_ENABLED==='true'&&process.env.CCEE_SYNC_WORKER_ENABLED==='true'&&process.env.CCEE_AUTOMATIC_READ_ENABLED==='true';}
 async list(t:TenantContext,page=0){cceeDataEnabled('CCEE_DATA_WORKSPACE_ENABLED');const ws=await this.data.workspace(t);return{...await this.data.rpc('ccee_customer_discovery_read',{p_org:t.organizationId,p_actor:t.userId,p_page:page}),canManage:ws.canManage};}
 async control(t:TenantContext,input:unknown){cceeDataEnabled('CCEE_DATA_WORKSPACE_ENABLED');await this.data.workspace(t);const b=cceeObject(input,['enabled','reason','requestId']);cceeText(b.reason,500,10);cceeUuid(b.requestId);if(typeof b.enabled!=='boolean')throw new CceeReadingError('INVALID_CUSTOMER_POLICY');return this.data.rpc('ccee_customer_discovery_control',{p_org:t.organizationId,p_actor:t.userId,p_enabled:b.enabled,p_reason:b.reason,p_request:b.requestId});}
 onModuleInit(){if(this.enabled())this.schedule();}
 onModuleDestroy(){this.stopped=true;clearTimeout(this.timer);}
 private schedule(){if(this.stopped)return;this.timer=setTimeout(()=>{void this.runOnce().catch(()=>this.log.warn('CCEE_CUSTOMER_DISCOVERY_UNCONFIRMED')).finally(()=>this.schedule());},30000);this.timer.unref?.();}
 async runOnce(){
  if(this.stopped||this.busy||!this.enabled())return;this.busy=true;let config:CceeConfig|undefined;
  try{
   const db=this.db.getClient(),claim=await db.rpc('ccee_customer_discovery_claim');if(claim.error)throw Error('CUSTOMER_CLAIM_UNCONFIRMED');const job=claim.data;if(!job)return;
   const args={p_id:job.id,p_lease:job.lease_id};let result:any=null,error:string|null=null;const hashes:string[]=[],transactions:string[]=[];let requests=0;
   const began=Date.now();
   try{
    config=cceeConfig(process.env);if(config.organizationId!==job.organization_id||job.organization_id!=='org_default')throw new CceeReadingError('ACCESS_CHANGED');
    let pages=1,total=-1;const rows:any[]=[];
    for(let page=1;page<=pages;page++){
     if(!this.enabled()||Date.now()-began>90000)throw new CceeReadingError('CUSTOMER_RUN_TIME_LIMIT');
     const reserve=await db.rpc('ccee_customer_discovery_reserve',args);if(reserve.error)throw new CceeReadingError(reserve.error.message?.includes('BUDGET')?'CUSTOMER_BUDGET_EXHAUSTED':'ACCESS_CHANGED');requests++;
     const payload=Buffer.from(participantRequest(config,job.tax_id,page));let xml:string;try{xml=await this.transport.fetch(config,'PARTICIPANT',payload);}finally{payload.fill(0);}
     const parsed=participantPage(xml,job.tax_id,page);hashes.push(parsed.hash);if(parsed.transactionId)transactions.push(parsed.transactionId);
     if(page>1&&(pages!==parsed.pages||total!==parsed.total))throw new CceeReadingError('CUSTOMER_PAGINATION_CHANGED');pages=parsed.pages;total=parsed.total;rows.push(...parsed.rows);
    }
    if(rows.length!==total)throw new CceeReadingError('CUSTOMER_COVERAGE_INCOMPLETE');
    result={...participantConclusion(rows,job.as_of),complete:true,rows,hashes,transactions,requests,durationMs:Date.now()-began};
   }catch(e){if(e instanceof CceeReadingError&&e.code==='CUSTOMER_NOT_FOUND'&&requests===1){result={...participantConclusion([],job.as_of),complete:true,rows:[],hashes:e.metrics?.hashes??[],transactions:e.metrics?.transactions??[],requests,durationMs:Date.now()-began,diagnostic:{operation:'listarParticipanteMercado',stage:'CNPJ_LOOKUP',code:'Server.3001',httpStatus:500}};}else{if(e instanceof CceeReadingError){hashes.push(...(e.metrics?.hashes??[]));transactions.push(...(e.metrics?.transactions??[]));}error=e instanceof CceeReadingError?e.code:'CUSTOMER_READ_NOT_CONFIRMED';result={hashes,transactions,requests,durationMs:Date.now()-began,diagnostic:{operation:'listarParticipanteMercado',stage:'CNPJ_LOOKUP',code:error,httpStatus:e instanceof CceeReadingError?e.httpStatus:null,transactionId:e instanceof CceeReadingError?e.transactionId:null,providerCode:e instanceof CceeReadingError?e.providerCode??null:null,providerDetail:e instanceof CceeReadingError?e.providerDetail??null:null}};}}
   const saved=await db.rpc('ccee_customer_discovery_finish',{...args,p_result:result,p_error:error});if(saved.error)throw Error('CUSTOMER_FINISH_UNCONFIRMED');
  }finally{config?.pfx.fill(0);this.busy=false;}
 }
}
@Controller('ccee-data/customers')
export class CceeCustomerDiscoveryController{
 constructor(private service:CceeCustomerDiscoveryService){}
 @Get() @Header('Cache-Control','private, no-store') list(@Tenant()t:TenantContext,@Query('page')p?:string){return this.service.list(t,Number(p??0));}
 @Post('policy') control(@Tenant()t:TenantContext,@Body()b:unknown){return this.service.control(t,b);}
}
