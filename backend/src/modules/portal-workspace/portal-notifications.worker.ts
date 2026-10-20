import {Injectable,Logger,OnModuleDestroy,OnModuleInit} from '@nestjs/common';
import {SupabaseService} from '../../services/supabase.service';
import {noticeReady,sendCustomerNotice} from '../customer-notices/customer-notice.transport';
import {WhatsappTemplatesService} from '../whatsapp-delivery/whatsapp-templates.service';
export function portalDeliveryBudget(env:NodeJS.ProcessEnv=process.env){
 const integer=(s:string|undefined,max:number)=>s&&/^[1-9]\d{0,9}$/.test(s)&&Number(s)<=max?Number(s):null;
 const daily=integer(env.PORTAL_NOTIFICATION_MAX_DAILY,100),budget=integer(env.PORTAL_NOTIFICATION_MONTHLY_BUDGET_MICRO_USD,1000000000);
 const costs=Object.fromEntries(['EMAIL','SMS','WHATSAPP'].map(c=>[c,integer(env['PORTAL_NOTIFICATION_'+c+'_COST_MICRO_USD'],999999999)]));
 return daily&&budget?{daily,budget,costs}:null;
}
@Injectable()
export class PortalNotificationsWorker implements OnModuleInit,OnModuleDestroy{
 private timer?:ReturnType<typeof setTimeout>;private stopped=false;private busy=false;private log=new Logger(PortalNotificationsWorker.name);
 constructor(private db:SupabaseService,private templates:WhatsappTemplatesService){}
 onModuleInit(){if(process.env.PORTAL_CLIENT_WORKSPACE_ENABLED==='true')this.schedule();}
 onModuleDestroy(){this.stopped=true;if(this.timer)clearTimeout(this.timer);}
 private schedule(){if(this.stopped)return;this.timer=setTimeout(()=>void this.runOnce().catch(()=>this.log.warn('PORTAL_NOTICE_PENDING')).finally(()=>this.schedule()),30000);this.timer.unref?.();}
 async runOnce(){if(this.stopped||this.busy||process.env.PORTAL_CLIENT_WORKSPACE_ENABLED!=='true')return;this.busy=true;try{
  const client=this.db.getClient(),deadlines=await client.rpc('collect_portal_deadline_notices');if(deadlines.error)throw Error('PORTAL_DEADLINES_PENDING');
  if(process.env.PORTAL_EXTERNAL_NOTIFICATIONS_ENABLED!=='true')return;const budget=portalDeliveryBudget();if(!budget)return;
  const templates=await this.templates.inspect(),channels=Object.keys(budget.costs).filter(c=>budget.costs[c]&&noticeReady(c.toLowerCase(),'PORTAL_UPDATE',templates));if(!channels.length)return;
  const claimed=await client.rpc('claim_portal_notification',{p_channels:channels,p_daily:budget.daily,p_budget:budget.budget,p_costs:budget.costs});if(claimed.error)throw Error('PORTAL_NOTICE_CLAIM');const d=claimed.data;if(!d)return;
  if(!channels.includes(d.channel))throw Error('PORTAL_NOTICE_SCOPE');
  const start=await client.rpc('start_portal_notification',{p_delivery:d.id});if(start.error||!start.data)return;
  const result=await sendCustomerNotice({id:d.id,channel:d.channel.toLowerCase(),event:'PORTAL_UPDATE',destination:start.data.destination},templates);
  const finish=await client.rpc('finish_portal_notification',{p_delivery:d.id,p_state:result.state,p_provider:result.providerId??null,p_reason:result.reason??null});if(finish.error)throw Error('PORTAL_NOTICE_UNCONFIRMED');
 }finally{this.busy=false;}}
}
