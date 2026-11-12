import {EvaPoller} from '../../common/workers/eva-poller';
import {observeEvaStage} from '../../common/services/eva-stage-metrics';
import {scheduledWorkEnabled} from '../../common/workers/process-role';
import {Injectable,Logger,OnModuleInit,OnModuleDestroy} from '@nestjs/common';
import {SupabaseService} from '../../services/supabase.service';
import {OcrAssistantService} from '../ocr/ocr-assistant.service';
import {BackofficeAiService,assistantAiEvidence} from '../ocr/backoffice-ai.service';
import {intakeOrganizations,intakeWorkerOrganizations} from './automatic-intake.service';
import {TenantContext} from '../../common/interfaces/tenant-context.interface';

/** Optional interpretation has a separate durable job and never mutates a
 * financial draft. Source-backed fields are available before a model runs. */
@Injectable()
export class AutomaticExplanationWorker implements OnModuleInit,OnModuleDestroy{
 private poller=new EvaPoller();private stopped=false;private busy=false;private log=new Logger(AutomaticExplanationWorker.name);
 constructor(private db:SupabaseService,private assistant:OcrAssistantService,private ai:BackofficeAiService){}
 onModuleInit(){if(!scheduledWorkEnabled('EVA'))return;if(intakeOrganizations().length)this.schedule();}
 onModuleDestroy(){this.poller.stop();this.stopped=true;}
 private schedule(){if(this.stopped)return;this.poller.start(()=>this.runOnce(),15000,()=>this.log.warn('EVA_EXPLANATION_PENDING'));}
 async runOnce(){if(this.busy||this.stopped||!intakeOrganizations().length)return;this.busy=true;
  try{
   const db=this.db.getClient(),organizations=await intakeWorkerOrganizations(db,'EXPLANATION');if(!organizations.length)return;
   const claimed=await db.rpc('eva_intake_explanation_task',{p_action:'claim',p_orgs:organizations});
   if(claimed.error)throw Error('EXPLANATION_CLAIM_UNCONFIRMED');const job=claimed.data;if(!job)return;this.poller.activity();
   const action=async(name:string,error?:string)=>{const r=await db.rpc('eva_intake_explanation_task',{p_action:name,p_id:job.id,p_lease:job.leaseId,...(error?{p_error:error}:{})});if(r.error)throw Error('EXPLANATION_CONTEXT_CHANGED');return r.data;};
   try{
    const ctx=await action('assert');if(!organizations.includes(ctx.organizationId))throw Error('EXPLANATION_SCOPE_CHANGED');
    const t:TenantContext={scope:'organization',organizationId:ctx.organizationId,email:'',...ctx.delegate};
    const plan=await observeEvaStage('EXPLANATION_INSPECT',()=>this.assistant.inspect(ctx.documentId,t));
    await action('assert');
    const result=await observeEvaStage('AI_INTERPRETATION',()=>this.ai.interpret(t,'Explique somente os preenchimentos comprovados e as confirmações restantes da proposta, sem inventar fontes ou valores.',assistantAiEvidence(plan),ctx.documentId));
    await action('finish',result.state==='READY'?undefined:'EXPLANATION_UNAVAILABLE');
   }catch{try{await action('finish','EXPLANATION_UNCONFIRMED');}catch{/* Lost acknowledgement never repeats inference. */}}
  }finally{this.busy=false;}
 }
}
