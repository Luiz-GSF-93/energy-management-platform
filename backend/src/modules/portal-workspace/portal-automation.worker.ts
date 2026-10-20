import {sourcePreparationEnabled} from '../ocr/source-preparation-v3';
import {Injectable,Logger,OnModuleDestroy,OnModuleInit} from '@nestjs/common';
import {randomUUID} from 'node:crypto';
import {SupabaseService} from '../../services/supabase.service';
import {OcrQueueService} from '../ocr/ocr-queue.service';
import {OcrAssistantService} from '../ocr/ocr-assistant.service';
import {CalculationAutofillService} from '../ocr/calculation-autofill.service';
import {EvaAssistedClosingService} from '../ocr/eva-assisted-closing.service';
import {TenantContext} from '../../common/interfaces/tenant-context.interface';

/** Uses an explicitly delegated internal actor. Reservations survive a process restart;
 * an uncertain write is stopped for reconciliation, never automatically replayed. */
@Injectable()
export class PortalAutomationWorker implements OnModuleInit,OnModuleDestroy {
 private timer?:ReturnType<typeof setTimeout>;private stopped=false;private busy=false;private log=new Logger(PortalAutomationWorker.name);
 constructor(private db:SupabaseService,private ocr:OcrQueueService,private assistant:OcrAssistantService,private autofill:CalculationAutofillService,private closing:EvaAssistedClosingService){}
 private enabled(){return process.env.PORTAL_CLIENT_WORKSPACE_ENABLED==='true'&&process.env.PORTAL_INVOICE_AUTOMATION_ENABLED==='true';}
 onModuleInit(){if(this.enabled())this.schedule();}
 onModuleDestroy(){this.stopped=true;if(this.timer)clearTimeout(this.timer);}
 private schedule(){if(this.stopped)return;this.timer=setTimeout(()=>void this.runOnce().catch(()=>this.log.warn('PORTAL_AUTOMATION_PENDING')).finally(()=>this.schedule()),15000);this.timer.unref?.();}
 async runOnce(){if(this.busy||this.stopped||!this.enabled())return;this.busy=true;try{
  const claimed=await this.db.getClient().rpc('claim_portal_invoice_automation');if(claimed.error)throw Error('PORTAL_AUTOMATION_CLAIM');const job=claimed.data;if(!job)return;
  const stage=job.stage;
  const finish=async(state:string,note:string,source:string|null=null)=>{const r=await this.db.getClient().rpc('finish_portal_invoice_automation',{p_id:job.id,p_reservation:job.reservation,p_state:state,p_note:note,p_source:source});if(r.error)throw Error('PORTAL_AUTOMATION_FINISH');};
  try {
   const live=await this.db.getClient().rpc('revalidate_portal_invoice_automation',{p_id:job.id,p_reservation:job.reservation});if(live.error||!live.data)throw Error('PORTAL_AUTOMATION_REVOKED');
   const t:TenantContext={scope:'organization',organizationId:job.organizationId,userId:live.data.userId,roleId:live.data.roleId,role:live.data.role,permissions:live.data.permissions,email:''};
   if(stage==='OCR'){await this.ocr.enqueue(t.organizationId,job.documentId,t.userId);await finish('ANALYSING','Leitura encaminhada à fila existente, com suas cotas e limites.');return;}
   const drafts=await this.assistant.prepareAutomatic(job.documentId,t);if(!drafts.complete&&!(sourcePreparationEnabled()&&'canContinue' in drafts&&drafts.canContinue===true))throw Error('DRAFT_REQUIRES_REVIEW');
   const query={consumerUnitId:job.unitId,month:job.month},preview:any=await this.autofill.inspect(query,t);
   if(!preview.available||preview.documentId!==job.documentId||preview.sourceHash!==job.fileHash||!preview.canPrepare)throw Error('CURRENT_INVOICE_NOT_ELIGIBLE');
   await this.autofill.prepare({...query,requestId:job.reservation,token:preview.token},t);
   // The closing service captures the full customer set; it never approves or publishes.
   const prepared=await this.closing.prepare({...query,requestId:randomUUID()},t);
   if(prepared.row?.state!=='READY_FOR_REVIEW'){await finish('AUTOMATION_STOPPED','A versão foi preservada com pendências de evidência. A equipe deve conferir o resumo antes da validação.',prepared.row?.id??null);return;}
   await finish('VALIDATING','Preparação versionada disponível para conferência da equipe. Nenhuma aprovação ou publicação automática.',prepared.row?.id??null);
  }catch(e){const reason=e instanceof Error&&/EVA:|identidade|UC, CNPJ/i.test(e.message)?e.message.slice(0,350):'Preparação interrompida. A equipe deve conferir as fontes e o histórico antes de repetir.';await finish('AUTOMATION_STOPPED',reason);}
 }finally{this.busy=false;}}
}
