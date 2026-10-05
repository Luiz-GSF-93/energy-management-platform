import {OcrMachineDraftService} from './ocr-machine-draft.service';
import {ocrDraftRole,ocrDraftPermission} from './ocr-draft-access';
import {randomUUID} from 'node:crypto';
import {Injectable, NotFoundException, Optional, ServiceUnavailableException} from '@nestjs/common';
import {BackofficeAiService,assistantAiEvidence} from './backoffice-ai.service';
import {TenantContext} from '../../common/interfaces/tenant-context.interface';
import {OcrAssistantService} from './ocr-assistant.service';
import {ocrReviewDigest} from './ocr-review.service';

const stages = ['source','fields','history','configuration','proposals','autofill','interpretation','ready'];
type Job = {id:string; key:string; expires:number; startedAt:string; state:'RUNNING'|'READY'|'FAILED'; completed:string[]; plan?:unknown; message?:string; elapsedMs?:number};
@Injectable()
export class OcrAssistantProgressService {
 // Transient progress only. Machine drafts are durable, idempotent and never approvals.
 // Restart/expiry requires a new inspection, never resubmission of a financial write.
 private readonly jobs = new Map<string,Job>();
 constructor(private assistant:OcrAssistantService,@Optional() private ai?:BackofficeAiService,@Optional() private drafts?:OcrMachineDraftService) {}
 private key(document:string,t:TenantContext){return ocrReviewDigest({document,org:t.organizationId,actor:t.userId,role:t.role,permissions:[...t.permissions].sort(),access:t.accessMode});}
 private cleanup(){for(const [id,job] of this.jobs)if(job.expires<Date.now())this.jobs.delete(id);}
 private present(job:Job){return {id:job.id,state:job.state,startedAt:job.startedAt,completed:job.completed,stages,elapsedMs:job.elapsedMs??Date.now()-Date.parse(job.startedAt),message:job.message,plan:job.state!=='FAILED'?job.plan:undefined};}
 async start(document:string,t:TenantContext){
  await this.assistant.authorize(t);this.cleanup();const key=this.key(document,t);
  const active=[...this.jobs.values()].find(j=>j.key===key&&j.state==='RUNNING');if(active)return this.present(active);
  if(this.jobs.size>=64)throw new ServiceUnavailableException('Assistente ocupado. Tente a conferência novamente; nenhum lançamento foi iniciado.');
  const job:Job={id:randomUUID(),key,expires:Date.now()+180000,startedAt:new Date().toISOString(),state:'RUNNING',completed:[]};this.jobs.set(job.id,job);
  void this.assistant.inspect(document,t,stage=>{if(stage!=='ready'&&stages.includes(stage)&&!job.completed.includes(stage))job.completed.push(stage);})
   .then(async plan=>{let automaticFill:unknown;let automaticPreparation:unknown;
    if(this.drafts&&ocrDraftRole(t)&&ocrDraftPermission(t)){
     // Save source-backed fields before waiting for a network inference. A later
     // interpretation may annotate them, but cannot replace confirmed values.
     try{automaticFill=await this.drafts.fill(t,plan);}catch{automaticFill={state:'FAILED',count:0,message:'O preenchimento automático não foi confirmado. Os valores extraídos permanecem visíveis; atualize para conferir.'};}
    }
    job.plan={...plan,automaticFill};
    if(ocrDraftRole(t)&&ocrDraftPermission(t)&&typeof this.assistant.prepareAutomatic==='function'){
     try{const prepared=await this.assistant.prepareAutomatic(document,t);automaticPreparation=prepared;if(prepared.current)plan=prepared.current;}catch{automaticPreparation={mode:'AUTOMATIC_DRAFT',receipts:[],complete:false,canPublish:false,message:'A preparação de lançamentos não foi confirmada. Confira os rascunhos antes de repetir.'};}
    }
    job.completed.push('autofill');
    job.plan={...plan,automaticFill,automaticPreparation};
    const aiReview=this.ai?await this.ai.interpret(t,'Interprete os campos extraídos e explique os preenchimentos e confirmações restantes desta fatura.',assistantAiEvidence(plan),document):undefined;
    if(this.drafts&&ocrDraftRole(t)&&ocrDraftPermission(t)&&aiReview?.state==='READY'){
     try{automaticFill=await this.drafts.fill(t,plan,aiReview);}catch{
      // The initial draft already committed. Report annotation failure without
      // claiming that saved fields were lost or automatically retrying writes.
      if((automaticFill as any)?.state==='FILLED_DRAFT')automaticFill={...(automaticFill as object),message:'Campos preenchidos e salvos. As observações da IA não foram salvas; confira as dúvidas exibidas antes de validar.'};
     }
    }
    job.plan={...plan,aiReview,automaticFill,automaticPreparation};job.completed.push('interpretation','ready');job.state='READY';job.message=aiReview?.state==='READY'?'bot-energy: interpretação concluída; confira os preenchimentos e as dúvidas. A aprovação financeira permanece com o gestor.':aiReview?.message;job.elapsedMs=Date.now()-Date.parse(job.startedAt);})
   .catch(()=>{job.state='FAILED';job.message='A conferência não foi concluída. Atualize para consultar novamente. Confira os rascunhos salvos antes de repetir.';job.elapsedMs=Date.now()-Date.parse(job.startedAt);});
  return this.present(job);
 }
 async status(document:string,id:string,t:TenantContext){
  await this.assistant.authorize(t);this.cleanup();const job=this.jobs.get(id);
  if(!job||job.key!==this.key(document,t))throw new NotFoundException('Conferência expirada ou indisponível nesta sessão. Atualize o assistente; não repita lançamentos.');
  return this.present(job);
 }
 async current(document:string,t:TenantContext){
  await this.assistant.authorize(t);this.cleanup();const key=this.key(document,t);
  const job=[...this.jobs.values()].filter(j=>j.key===key).sort((a,b)=>Date.parse(b.startedAt)-Date.parse(a.startedAt))[0];
  if(!job)return {state:'NOT_STARTED',completed:[] as string[],stages,message:'Não há preparação ativa nesta sessão. Abra a auditoria da fatura para iniciar. Isso não significa que registros anteriores foram apagados.'};
  return {id:job.id,state:job.state,startedAt:job.startedAt,completed:job.completed,stages,elapsedMs:job.elapsedMs??Date.now()-Date.parse(job.startedAt),message:job.message};
 }
}
