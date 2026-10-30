import {Injectable,Logger,OnModuleDestroy,OnModuleInit} from '@nestjs/common';
import {SupabaseService} from '../../services/supabase.service';
import {AneelTariffFlagsConnector} from './aneel-tariff-flags.connector';
@Injectable()
export class AneelTariffFlagsWorker implements OnModuleInit,OnModuleDestroy{
 private timer?:ReturnType<typeof setTimeout>;private stopped=false;private busy=false;private logger=new Logger(AneelTariffFlagsWorker.name);
 constructor(private db:SupabaseService,private connector:AneelTariffFlagsConnector){}
 onModuleInit(){this.schedule();}onModuleDestroy(){this.stopped=true;clearTimeout(this.timer);}
 private schedule(){if(this.stopped)return;this.timer=setTimeout(()=>void this.runOnce().catch(()=>this.logger.warn('ANEEL_FLAG_SYNC_UNCONFIRMED')).finally(()=>this.schedule()),30000);this.timer.unref?.();}
 private async rpc(action:string,job:any=null,body:any={}){const r=await this.db.getClient().rpc('aneel_flag_worker',{p_action:action,p_org:'org_default',p_run:job?.runId??null,p_token:job?.token??null,p_body:body});if(r.error)throw Error('SYNC_STATE_UNAVAILABLE');return r.data;}
 async runOnce(){
  if(this.busy||this.stopped)return;this.busy=true;
  try{const job=await this.rpc('claim');if(!job)return;if(job.organizationId!=='org_default'||!job.runId||!job.token||!/^20[0-9]{2}-[0-9]{2}-[0-9]{2}$/.test(job.today??''))throw Error('INVALID_SYNC_SCOPE');
   try{const result=await this.connector.read(async()=>{const r=await this.rpc('request',job);if(!r?.reserved)throw Error('REQUEST_NOT_RESERVED');},job.today);await this.rpc('finish',job,result);}
   catch(e){const code=e instanceof Error&&/^[A-Z_]{3,60}$/.test(e.message)?e.message:'OFFICIAL_SOURCE_UNAVAILABLE';await this.rpc('finish',job,{error:code});}
  }finally{this.busy=false;}
 }
}
