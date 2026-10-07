import {Injectable,Logger,OnModuleDestroy,OnModuleInit} from '@nestjs/common';
import {SupabaseService} from '../../services/supabase.service';
import {ReportsService} from './reports.service';
import {reportPdf,reportExcel} from './report.render';
import {reportProviderReady,sendReportDelivery,ReportAttachment} from './report-delivery';
@Injectable()
export class ReportDeliveryWorker implements OnModuleInit,OnModuleDestroy{
 private timer?:ReturnType<typeof setTimeout>;private stopped=false;private busy=false;private readonly logger=new Logger(ReportDeliveryWorker.name);
 constructor(private db:SupabaseService,private reports:ReportsService){}
 onModuleInit(){if(process.env.REPORTS_DELIVERY_ENABLED==='true')this.schedule();}
 onModuleDestroy(){this.stopped=true;if(this.timer)clearTimeout(this.timer);}
 private schedule(){if(this.stopped)return;this.timer=setTimeout(()=>{void this.runOnce().catch(()=>this.logger.warn('REPORT_DELIVERY_PENDING')).finally(()=>this.schedule());},15000);this.timer.unref?.();}
 async runOnce(){
  if(this.stopped||this.busy||process.env.REPORTS_DELIVERY_ENABLED!=='true')return;this.busy=true;
  try{
   const client=this.db.getClient(),enabled=['email','whatsapp'].filter(c=>reportProviderReady(c));
   if(!enabled.length)return;
   const claim=await client.rpc('claim_report_delivery',{p_channels:enabled});if(claim.error)throw Error('DELIVERY_CLAIM_UNAVAILABLE');if(!claim.data)return;
   const {delivery,job,context}=claim.data;
   if(delivery.organization_id!==context.organizationId||job.organization_id!==context.organizationId||job.owner_id!==context.userId||delivery.job_id!==job.id||!['email','whatsapp'].includes(delivery.channel))throw Error('DELIVERY_SCOPE_INVALID');
   let attachments:ReportAttachment[]=[];
   try{
    // Recheck report integrity and current permissions before building any private attachment.
    for(const item of job.report_ids){const r=await this.reports.one(item.id,context);if(r.customer_id!==job.config.customerId||r.consumer_unit_id!==job.config.unitId)throw Error('REPORT_SCOPE_INVALID');
     if(delivery.channel==='email')for(const format of job.config.formats){const bytes=format==='pdf'?await reportPdf(r):await reportExcel(r);attachments.push({filename:`EnergyOS-${item.kind}-${job.month.slice(0,7)}.${format==='pdf'?'pdf':'xlsx'}`,content:Buffer.from(bytes).toString('base64')});}
    }
   }catch{await client.rpc('finish_report_delivery',{p_org:delivery.organization_id,p_id:delivery.id,p_lease:delivery.lease_id,p_state:'FAILED',p_provider_id:null,p_reason:'REPORT_UNAVAILABLE'});return;}
   const start=await client.rpc('start_report_delivery',{p_org:delivery.organization_id,p_id:delivery.id,p_lease:delivery.lease_id});if(start.error)throw Error('DELIVERY_REVALIDATION_FAILED');if(start.data!==true)return;
   const result=await sendReportDelivery({id:delivery.id,channel:delivery.channel,destination:delivery.destination,attachments});
   const finish=await client.rpc('finish_report_delivery',{p_org:delivery.organization_id,p_id:delivery.id,p_lease:delivery.lease_id,p_state:result.state,p_provider_id:result.providerId??null,p_reason:result.reason??null});if(finish.error)throw Error('DELIVERY_RESULT_UNAVAILABLE');
  }finally{this.busy=false;}
 }
}
