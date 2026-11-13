import {manualPreparationCommand} from './eva-manual-receipt';
import {Injectable,Logger,OnModuleDestroy,OnModuleInit} from '@nestjs/common';
import {SupabaseService} from '../../services/supabase.service';
import {TenantContext} from '../../common/interfaces/tenant-context.interface';
import {EvaPoller} from '../../common/workers/eva-poller';
import {scheduledWorkEnabled} from '../../common/workers/process-role';
import {observeEvaStage} from '../../common/services/eva-stage-metrics';
import {EvaAssistedClosingService} from './eva-assisted-closing.service';
import {EvaManualPreparationQueue} from './eva-manual-preparation.queue';

function preparationDiagnostic(error:unknown){
 try{
  const response=(error as any)?.getResponse?.();
  if(response?.code==='EVA_CLOSING_SOURCE_TIMEOUT'&&['capture','reserve','finish'].includes(response.stage))return 'PREPARATION_'+String(response.stage).toUpperCase()+'_TIMEOUT';
  if(response?.code==='EVA_READ_UNAVAILABLE'){
   const reads:Record<string,string>={'closing:snapshot':'PREPARATION_SNAPSHOT_TIMEOUT','eva_scoped_closing_action:capture':'PREPARATION_CAPTURE_TIMEOUT','eva_scoped_closing_action:history':'PREPARATION_HISTORY_TIMEOUT'};
   if(typeof response.read==='string'&&Object.prototype.hasOwnProperty.call(reads,response.read))return reads[response.read];
  }
 }catch{/* Only fixed diagnostics may enter the journal. */}
 return 'PREPARATION_RECONCILIATION_REQUIRED';
}

/** Executes a persisted intent once. Expired/uncertain writes never become automatic retries. */
@Injectable()
export class EvaManualPreparationWorker implements OnModuleInit,OnModuleDestroy{
 private poller=new EvaPoller();private busy=false;private stopped=false;private log=new Logger(EvaManualPreparationWorker.name);
 constructor(private db:SupabaseService,private queue:EvaManualPreparationQueue,private closing:EvaAssistedClosingService){}
 onModuleInit(){if(this.queue.enabled()&&scheduledWorkEnabled('EVA'))this.poller.start(()=>this.runOnce(),5000,()=>this.log.warn('EVA_MANUAL_QUEUE_PENDING'));}
 onModuleDestroy(){this.stopped=true;this.poller.stop();}
 private async rpc(action:string,id?:string,token?:string,body:any={}){
  const r=await manualPreparationCommand(this.db.getClient(),'eva_manual_preparation_worker',{p_action:action,...(id?{p_id:id,p_token:token}:{}),p_body:body});
  if(r.error)throw Error('MANUAL_PREPARATION_ACK_PENDING');return r.data;
 }
 async runOnce(){
  if(this.stopped||this.busy||!this.queue.enabled()||!scheduledWorkEnabled('EVA'))return;this.busy=true;
  try{
   const claim=await this.rpc('claim');if(!claim)return;this.poller.activity();
   let writing=false,done=false,heartbeat:ReturnType<typeof setTimeout>|undefined;
   const keepAlive=()=>{if(done||this.stopped)return;heartbeat=setTimeout(async()=>{try{await this.rpc('heartbeat',claim.id,claim.token);}catch{this.log.warn('EVA_MANUAL_LEASE_UNCONFIRMED');}finally{keepAlive();}},30000);heartbeat.unref();};keepAlive();
   try{
    const context=await this.rpc('context',claim.id,claim.token),job=context?.job,actor=context?.delegate;
    if(job?.id!==claim.id||!job.organizationId||!job.consumerUnitId||!job.customerId||!job.executionId||!['UNIT','CUSTOMER'].includes(job.scopeKind)||!actor?.userId||!actor.roleId||!Array.isArray(actor.permissions))throw Error('MANUAL_PREPARATION_CONTEXT_INVALID');
    const t:TenantContext={...actor,scope:'organization',organizationId:job.organizationId,email:''};
    // Set the uncertainty boundary before invoking any service capable of draft writes.
    const began=await this.rpc('begin',claim.id,claim.token);
    if(began?.deferred){await this.rpc('defer',claim.id,claim.token);return;}
    if(began?.accepted!==true)throw Error('MANUAL_PREPARATION_BEGIN_UNCONFIRMED');writing=true;
    const result=await observeEvaStage('MANUAL_PREPARATION',()=>this.closing.prepare({consumerUnitId:job.consumerUnitId,month:job.month,scopeKind:job.scopeKind,requestId:job.executionId},t));
    if(!result?.row?.id||result.row.organization_id!==job.organizationId||result.row.customer_id!==job.customerId||result.row.month!==job.month||!result.row.report?.unitIds?.includes(job.consumerUnitId))throw Error('MANUAL_PREPARATION_RESULT_INVALID');
    await this.rpc('finish',claim.id,claim.token,{state:'SUCCEEDED',closingId:result.row.id});
   }catch(error){
    try{await this.rpc('finish',claim.id,claim.token,{state:writing?'UNKNOWN':'FAILED',code:writing?preparationDiagnostic(error):'PREPARATION_ACCESS_OR_SOURCE_UNAVAILABLE'});}catch{this.log.warn('EVA_MANUAL_RESULT_UNCONFIRMED');}
   }finally{done=true;clearTimeout(heartbeat);}
  }finally{this.busy=false;}
 }
}
