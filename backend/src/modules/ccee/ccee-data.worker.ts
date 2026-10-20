import {CceeDriConnector} from './ccee-dri.connector';
import {isDri} from './ccee-dri.model';
import {Injectable,Logger,OnModuleDestroy,OnModuleInit,Optional} from '@nestjs/common';
import {SupabaseService} from '../../services/supabase.service';
import {CceePrivateConnector,CceeReadingError} from './ccee-private.connector';
import {validateCceeRecord} from './ccee-validation';
@Injectable()
export class CceeDataWorker implements OnModuleInit,OnModuleDestroy{
 private busy=false;private stopped=false;private timer?:ReturnType<typeof setTimeout>;private logger=new Logger(CceeDataWorker.name);
 constructor(private db:SupabaseService,private connector:CceePrivateConnector,@Optional() private dri?:CceeDriConnector){}
 private enabled(){return process.env.CCEE_DATA_WORKSPACE_ENABLED==='true'&&process.env.CCEE_SYNC_WORKER_ENABLED==='true';}
 onModuleInit(){if(this.enabled())this.schedule();}
 onModuleDestroy(){this.stopped=true;clearTimeout(this.timer);}
 private schedule(){if(this.stopped)return;this.timer=setTimeout(()=>{void this.runOnce().catch(()=>this.logger.warn('CCEE_READING_RESULT_NOT_CONFIRMED')).finally(()=>this.schedule());},30000);this.timer.unref?.();}
 async runOnce(){
  if(this.stopped||this.busy||!this.enabled())return;this.busy=true;
  try{
   // Private flag is checked inside the transaction selector too, so blocked jobs are not lost.
   const client=this.db.getClient();let claim:any;
   if(process.env.CCEE_DRI_READ_ENABLED==='true'&&this.dri){claim=await client.rpc('ccee_claim_dri_reading');if(claim.error)throw new Error('DRI_CLAIM_UNAVAILABLE');}
   if(!claim?.data)claim=await client.rpc('ccee_claim_reading',{p_private:process.env.CCEE_PRIVATE_READ_ENABLED==='true'});
   if(claim.error)throw new Error('CLAIM_UNAVAILABLE');if(!claim.data)return;const job=claim.data;
   const revalidate=async()=>{
    if(!this.enabled()||(isDri(job.kind)?process.env.CCEE_DRI_READ_ENABLED!=='true':job.kind!=='PLD'&&process.env.CCEE_PRIVATE_READ_ENABLED!=='true'))throw new CceeReadingError('FUNCTION_DISABLED');
    const r=await client.rpc('ccee_assert_reading',{p_id:job.id,p_lease:job.lease_id});if(r.error||!r.data||r.data.organization_id!==job.organization_id||r.data.lease_id!==job.lease_id)throw new CceeReadingError('ACCESS_CHANGED');
   };
   let result:any=null,errorCode:string|null=null,failureMetrics:any=null;
   try{result=isDri(job.kind)?await this.dri!.execute(job,revalidate):await this.connector.execute(job,revalidate);if(result.record)validateCceeRecord(result.record,result.record.binding);}
   catch(e){errorCode=e instanceof CceeReadingError?e.code:'READ_NOT_CONFIRMED';failureMetrics=e instanceof CceeReadingError?e.metrics??null:null;}
   // If rights changed, do not persist returned private data; only record a bounded failure.
   if(!errorCode)try{await revalidate();}catch{errorCode='ACCESS_CHANGED';}
   const finish=await client.rpc(isDri(job.kind)?'ccee_finish_dri_reading':'ccee_finish_reading',{p_id:job.id,p_lease:job.lease_id,p_result:errorCode?failureMetrics:result,p_error:errorCode});
   if(finish.error)throw new Error('FINISH_UNCONFIRMED');
  }finally{this.busy=false;}
 }
}
