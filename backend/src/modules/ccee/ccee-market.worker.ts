import {Injectable,Logger,OnModuleInit,OnModuleDestroy} from '@nestjs/common';
import {SupabaseService} from '../../services/supabase.service';
import {CceeMarketConnector} from './ccee-market.connector';
import {CceeReadingError} from './ccee-private.connector';
@Injectable()
export class CceeMarketWorker implements OnModuleInit,OnModuleDestroy{
 private busy=false;private stopped=false;private timer?:ReturnType<typeof setTimeout>;private logger=new Logger(CceeMarketWorker.name);
 constructor(private db:SupabaseService,private connector:CceeMarketConnector){}
 private enabled(){return process.env.CCEE_MARKET_SYNC_ENABLED==='true'&&process.env.CCEE_DATA_WORKSPACE_ENABLED==='true'&&process.env.CCEE_READ_ENABLED==='true';}
 onModuleInit(){if(this.enabled())this.schedule();}
 onModuleDestroy(){this.stopped=true;clearTimeout(this.timer);}
 private schedule(){if(this.stopped)return;this.timer=setTimeout(()=>{void this.runOnce().catch(()=>this.logger.warn('CCEE_MARKET_RESULT_NOT_CONFIRMED')).finally(()=>this.schedule());},30000);this.timer.unref?.();}
 private async rpc(name:string,args:Record<string,unknown>){const r=await this.db.getClient().rpc(name,args);if(r.error){if(r.error.code==='42501')throw new CceeReadingError('ACCESS_CHANGED');if(r.error.code==='P0001'&&r.error.message==='MARKET_REQUEST_BUDGET_EXHAUSTED')throw new CceeReadingError('BUDGET_EXHAUSTED');throw new CceeReadingError('DATABASE_RESULT_NOT_CONFIRMED');}return r.data;}
 async runOnce(){
  if(this.stopped||this.busy||!this.enabled()||!process.env.CCEE_ORGANIZATION_ID)return;this.busy=true;
  try{
   const job=await this.rpc('ccee_market_claim',{p_org:process.env.CCEE_ORGANIZATION_ID,p_private:process.env.CCEE_MARKET_FIVE_MINUTE_ENABLED==='true'});if(!job)return;
   if(job.organizationId!==process.env.CCEE_ORGANIZATION_ID||!['PLD_HOURLY','MEASUREMENTS_5M'].includes(job.kind)||!job.id||!job.leaseId)throw new CceeReadingError('ACCESS_CHANGED');
   let result:any=null,error:string|null=null;
   const check=async()=>{if(!this.enabled()||job.kind==='MEASUREMENTS_5M'&&process.env.CCEE_MARKET_FIVE_MINUTE_ENABLED!=='true')throw new CceeReadingError('FUNCTION_DISABLED');const v=await this.rpc('ccee_market_assert',{p_id:job.id,p_lease:job.leaseId});if(v.organizationId!==job.organizationId||v.leaseId!==job.leaseId||v.kind!==job.kind)throw new CceeReadingError('ACCESS_CHANGED');};
   try{result=await this.connector.collect(job,async()=>{await check();await this.rpc('ccee_market_reserve',{p_id:job.id,p_lease:job.leaseId,p_homologation_limit:process.env.CCEE_MARKET_HOMOLOGATION_MODE==='false'?null:20});});await check();}
   catch(e){error=e instanceof CceeReadingError?e.code:'READ_NOT_CONFIRMED';}
   await this.rpc('ccee_market_finish',{p_id:job.id,p_lease:job.leaseId,p_result:error?null:result,p_error:error});
  }finally{this.busy=false;}
 }
}
