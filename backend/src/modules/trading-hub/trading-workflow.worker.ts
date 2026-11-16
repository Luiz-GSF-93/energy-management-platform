import {scheduledWorkEnabled} from '../../common/workers/process-role';
import {Injectable,Logger,OnModuleDestroy,OnModuleInit,Optional} from '@nestjs/common';
import {TradingCommunicationService} from './trading-communication.service';
import {TradingClientMonitorService} from './trading-client-monitor.service';
import {SupabaseService} from '../../services/supabase.service';
import {portalDeliveryBudget} from '../portal-workspace/portal-notifications.worker';
import {WhatsappTemplatesService} from '../whatsapp-delivery/whatsapp-templates.service';
import {sendWorkflowNotice,tradingApprovalDeliveryEnabled} from './trading-workflow-delivery';
@Injectable()
export class TradingWorkflowWorker implements OnModuleInit,OnModuleDestroy{
 private timer?:ReturnType<typeof setTimeout>;private busy=false;private stopped=false;private log=new Logger(TradingWorkflowWorker.name);
 constructor(private db:SupabaseService,private templates:WhatsappTemplatesService,@Optional() private communication?:TradingCommunicationService,@Optional() private clientMonitor?:TradingClientMonitorService){}
 onModuleInit(){if(!scheduledWorkEnabled('API'))return;this.schedule();}onModuleDestroy(){this.stopped=true;clearTimeout(this.timer);}
 private schedule(){if(this.stopped)return;this.timer=setTimeout(()=>void this.runOnce().catch(()=>this.log.warn('TRADING_DELIVERY_UNCONFIRMED')).finally(()=>this.schedule()),15000);this.timer.unref?.();}
 async runOnce(){if(this.stopped||this.busy)return;this.busy=true;
  try{await this.clientMonitor?.deliverOnce().catch(()=>this.log.warn('TRADING_CLIENT_MONITOR_UNCONFIRMED'));await this.communication?.deliverOnce().catch(()=>this.log.warn('TRADING_QUOTE_DELIVERY_UNCONFIRMED'));const client=this.db.getClient();const reminder=await client.rpc('collect_trading_workflow_reminders');if(reminder.error)throw Error('REMINDER_FAILED');if(!tradingApprovalDeliveryEnabled())return;const budget=portalDeliveryBudget();if(!budget)return;const args={p_action:'CLAIM',p_id:null,p_lease:null,p_daily:budget.daily,p_budget:budget.budget,p_costs:budget.costs,p_result:null};const c=await client.rpc('trading_workflow_delivery',args);if(c.error)throw Error('CLAIM_FAILED');const d=c.data;if(!d)return;
   const start=await client.rpc('trading_workflow_delivery',{...args,p_action:'START',p_id:d.id,p_lease:d.lease});if(start.error)throw Error('START_FAILED');if(!start.data)return;
   const templates=d.channel==='WHATSAPP'?await this.templates.inspect():undefined;
   const result=await sendWorkflowNotice({...d,destination:start.data.destination},templates);
   const finished=await client.rpc('trading_workflow_delivery',{...args,p_action:'FINISH',p_id:d.id,p_lease:d.lease,p_result:result});if(finished.error)throw Error('FINISH_FAILED');
  }finally{this.busy=false;}
 }
}
