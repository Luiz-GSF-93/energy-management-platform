import {Injectable,Logger,OnModuleDestroy,OnModuleInit} from '@nestjs/common';
import {SupabaseService} from '../../services/supabase.service';
import {ReportsService} from './reports.service';
import {reportPolicy} from './report-policy';
@Injectable()
export class ReportPreparationWorker implements OnModuleInit,OnModuleDestroy{
 private timer?:ReturnType<typeof setTimeout>;private stopped=false;private busy=false;private readonly logger=new Logger(ReportPreparationWorker.name);
 constructor(private db:SupabaseService,private reports:ReportsService){}
 onModuleInit(){if(process.env.REPORTS_RECURRENCE_ENABLED!=='false')this.schedule();}
 onModuleDestroy(){this.stopped=true;if(this.timer)clearTimeout(this.timer);}
 private schedule(){if(this.stopped)return;this.timer=setTimeout(()=>{void this.runOnce().catch(()=>this.logger.warn('REPORT_PREPARATION_PENDING')).finally(()=>this.schedule());},15000);this.timer.unref?.();}
 async runOnce(){
  if(this.stopped||this.busy)return;this.busy=true;
  try{
   const c=this.db.getClient(),r=await c.rpc('claim_report_preparation');if(r.error)throw Error('CLAIM_UNAVAILABLE');if(!r.data)return;
   const {job,context}=r.data,config=reportPolicy(job.config),uuid=/^[0-9a-f-]{36}$/i;
   if(!uuid.test(job.id)||!uuid.test(job.lease_id)||typeof job.organization_id!=='string'||job.organization_id!==context.organizationId||job.owner_id!==context.userId||!/^(20|21)\d{2}-(0[1-9]|1[0-2])-01$/.test(job.month)||config.customerId!==job.config.customerId||config.unitId!==job.config.unitId)throw Error('CLAIM_INVALID');
   let reason:string|null=null;const prepared:{id:string;kind:string}[]=[];
   try{
    for(const kind of config.kinds){const report=await this.reports.create({kind,customerId:config.customerId,unitId:config.unitId,from:job.month.slice(0,7),to:job.month.slice(0,7),requestId:job.requests[kind]},context);prepared.push({id:report.id,kind});}
   }catch(e){reason=e instanceof Error&&e.message.includes('Não há resultados publicados')?'WAITING_PUBLICATION':'PREPARATION_UNAVAILABLE';}
   const done=await c.rpc('finish_report_preparation',{p_org:job.organization_id,p_job:job.id,p_lease:job.lease_id,p_reports:prepared,p_reason:reason});if(done.error)throw Error('FINISH_UNAVAILABLE');
  }finally{this.busy=false;}
 }
}
