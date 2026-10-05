import {Injectable,Logger,OnModuleInit,OnModuleDestroy} from '@nestjs/common';
import {SupabaseService} from '../../services/supabase.service';
import {PlatformCostsService} from './platform-costs.service';
import {runtimeMetrics} from './runtime-metrics';
import {sendCostAlert,whatsappConfigured} from './cost-notifications';
@Injectable()
export class PlatformCostsWorker implements OnModuleInit,OnModuleDestroy {
 private timer?:ReturnType<typeof setTimeout>;private stopped=false;private readonly logger=new Logger(PlatformCostsWorker.name);
 private requests=0;private durationMs=0;private failures=0;
 constructor(private db:SupabaseService,private costs:PlatformCostsService){}
 observe(milliseconds:number,status:number){this.requests++;this.durationMs+=milliseconds;if(status>=500)this.failures++;}
 onModuleInit(){this.schedule();}
 onModuleDestroy(){this.stopped=true;if(this.timer)clearTimeout(this.timer);}
 private schedule(){if(this.stopped)return;this.timer=setTimeout(async()=>{try{await this.tick();}catch{this.logger.warn('PLATFORM_COST_MONITOR_PENDING');}finally{this.schedule();}},60000);this.timer.unref();}
 async tick(){
  const c=this.db.getClient(),sample=await runtimeMetrics();
  const metrics={...sample.metrics,requests:this.requests,responseAverageMs:this.requests?this.durationMs/this.requests:null,serverErrors:this.failures};
  const saved=await c.from('platform_runtime_samples').insert({service:'API',instance:sample.instance,metrics});if(saved.error)throw Error('TELEMETRY_NOT_SAVED');
  this.requests=0;this.durationMs=0;this.failures=0;
  const summary=await this.costs.summary(),month=summary.month+'-01',policy=summary.policy;
  const warnings:{key:string;org:string|null;level:string;message:string}[]=[];
  for(const row of summary.companies)if(row.level)warnings.push({key:row.organization_id+':'+row.level,org:row.organization_id,level:row.level,message:`IA — ${row.name}: consumo estimado US$ ${(row.actual_micro_usd/1e6).toFixed(4)}, reservas US$ ${(row.reserved_micro_usd/1e6).toFixed(4)}, cota mensal US$ ${(row.quota_micro_usd/1e6).toFixed(2)}. Nível ${row.level}.`});
  if(summary.level)warnings.push({key:'global:'+summary.level,org:null,level:summary.level,message:`IA da plataforma: risco ${summary.level}. Confira consumo, reservas, projeção e cotas das licenças ativas.`});
  if(summary.total_cost_level)warnings.push({key:'total-cost:'+summary.total_cost_level,org:null,level:summary.total_cost_level,message:`Custo total registrado da plataforma: R$ ${(summary.total_cost_brl_cents!/100).toFixed(2)}, incluindo IA estimada e infraestrutura informada. Risco ${summary.total_cost_level}. Confira limites e projeção no painel.`});
  const ram=metrics.memoryLimitBytes&&metrics.containerMemoryBytes?metrics.containerMemoryBytes/metrics.memoryLimitBytes:null;
  const disk=metrics.diskTotalBytes&&metrics.diskUsedBytes?metrics.diskUsedBytes/metrics.diskTotalBytes:null;
  if((metrics.cpuPercent??0)>85||ram!==null&&ram>.85||disk!==null&&disk>.9)warnings.push({key:'runtime:'+sample.instance+':'+new Date().toISOString().slice(0,10),org:null,level:'PERFORMANCE',message:'API próxima da capacidade de CPU, memória ou disco. Confira as métricas da instância no painel.'});
  for(const w of warnings)for(const channel of ['panel',...(policy.email_enabled&&policy.email?['email']:[]),...(policy.whatsapp?['whatsapp']:[])]){
   const a=await c.from('platform_cost_alerts').upsert({dedupe_key:month+':'+w.key+':'+channel,organization_id:w.org,month,level:w.level,message:w.message,channel,state:channel==='panel'?'SENT':'PENDING'},{onConflict:'dedupe_key',ignoreDuplicates:true});if(a.error)throw Error('ALERT_NOT_SAVED');
  }
  const channels=[...(policy.email_enabled&&policy.email&&process.env.RESEND_API_KEY?['email']:[]),...(policy.whatsapp&&whatsappConfigured()?['whatsapp']:[])];
  if(!channels.length)return;
  const claimed=await c.rpc('claim_platform_cost_alert',{p_channels:channels});if(claimed.error)throw Error('ALERT_CLAIM_FAILED');if(!claimed.data)return;
  const state=await sendCostAlert(claimed.data,policy);
  const result=await c.from('platform_cost_alerts').update({state,sent_at:state==='SENT'?new Date().toISOString():null}).eq('id',claimed.data.id).eq('state','SENDING');if(result.error)throw Error('ALERT_RECEIPT_PENDING');
 }
}
