import {scheduledWorkEnabled} from '../../common/workers/process-role';
import {Injectable,Logger,OnModuleDestroy,OnModuleInit} from '@nestjs/common';
import {SupabaseService} from '../../services/supabase.service';
import {CceeService} from './ccee.service';
@Injectable()
export class CceeMonthlyReferenceWorker implements OnModuleInit,OnModuleDestroy{
 private busy=false;private stopped=false;private timer?:ReturnType<typeof setTimeout>;private log=new Logger(CceeMonthlyReferenceWorker.name);
 constructor(private db:SupabaseService,private ccee:CceeService){}
 private enabled(){return process.env.CCEE_MARKET_SYNC_ENABLED==='true'&&process.env.CCEE_DATA_WORKSPACE_ENABLED==='true'&&process.env.CCEE_READ_ENABLED==='true';}
 onModuleInit(){if(!scheduledWorkEnabled('API'))return;if(this.enabled())this.schedule();}
 onModuleDestroy(){this.stopped=true;clearTimeout(this.timer);}
 private schedule(){if(this.stopped)return;this.timer=setTimeout(()=>{void this.runOnce().catch(()=>this.log.warn('CCEE_MONTHLY_REFERENCE_UNCONFIRMED')).finally(()=>this.schedule());},30000);this.timer.unref?.();}
 async runOnce(){
  if(this.busy||this.stopped||this.ccee.isBusy?.()||!this.enabled()||!process.env.CCEE_ORGANIZATION_ID)return;this.busy=true;
  try{
   const db=this.db.getClient(),claim=await db.rpc('ccee_monthly_reference_claim',{p_org:process.env.CCEE_ORGANIZATION_ID});
   if(claim.error)throw Error('MONTHLY_REFERENCE_CLAIM_UNCONFIRMED');const task=claim.data;if(!task)return;
   if(task.organization_id!==process.env.CCEE_ORGANIZATION_ID||task.kind!=='PLD_MONTHLY')throw Error('MONTHLY_REFERENCE_SCOPE_CHANGED');
   const action=async(name:string,body:any)=>{if(!this.enabled())throw Error('FUNCTION_DISABLED');const r=await db.rpc('ccee_reference_task',{p_org:task.organization_id,p_actor:task.actor_id,p_action:name,p_id:task.id,p_lease:task.lease_id,p_body:body});if(r.error)throw Error(r.error.message?.includes('BUDGET')?'BUDGET_EXHAUSTED':'REFERENCE_CONTEXT_CHANGED');return r.data;};
   let result:any,error:string|undefined,reservationError:string|undefined;
   try{result=await this.ccee.preview({month:task.month.slice(0,7)},{attempt:async()=>{try{await action('reserve',{});}catch(e){reservationError=e instanceof Error?e.message:'REFERENCE_CONTEXT_CHANGED';throw e;}},response:()=>{}});}catch(e){error=reservationError??'CCEE_PREVIEW_UNAVAILABLE';}
   await action('finish',error?{error}:{result});
  }finally{this.busy=false;}
 }
}
