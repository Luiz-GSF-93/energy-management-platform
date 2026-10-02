import {randomUUID} from 'node:crypto';
import {Injectable, NotFoundException, ServiceUnavailableException} from '@nestjs/common';
import {TenantContext} from '../../common/interfaces/tenant-context.interface';
import {OcrAssistantService} from './ocr-assistant.service';
import {ocrReviewDigest} from './ocr-review.service';

const stages = ['source','fields','history','configuration','proposals','ready'];
type Job = {id:string; key:string; expires:number; startedAt:string; state:'RUNNING'|'READY'|'FAILED'; completed:string[]; plan?:unknown; message?:string; elapsedMs?:number};
@Injectable()
export class OcrAssistantProgressService {
 // Only transient, read-only proposals. Financial writes never depend on this cache.
 // Restart/expiry requires a new inspection, never resubmission of a financial write.
 private readonly jobs = new Map<string,Job>();
 constructor(private assistant:OcrAssistantService) {}
 private key(document:string,t:TenantContext){return ocrReviewDigest({document,org:t.organizationId,actor:t.userId,role:t.role,permissions:[...t.permissions].sort(),access:t.accessMode});}
 private cleanup(){for(const [id,job] of this.jobs)if(job.expires<Date.now())this.jobs.delete(id);}
 private present(job:Job){return {id:job.id,state:job.state,startedAt:job.startedAt,completed:job.completed,stages,elapsedMs:job.elapsedMs??Date.now()-Date.parse(job.startedAt),message:job.message,plan:job.state==='READY'?job.plan:undefined};}
 async start(document:string,t:TenantContext){
  await this.assistant.authorize(t);this.cleanup();const key=this.key(document,t);
  const active=[...this.jobs.values()].find(j=>j.key===key&&j.state==='RUNNING');if(active)return this.present(active);
  if(this.jobs.size>=64)throw new ServiceUnavailableException('Assistente ocupado. Tente a conferência novamente; nenhum lançamento foi iniciado.');
  const job:Job={id:randomUUID(),key,expires:Date.now()+180000,startedAt:new Date().toISOString(),state:'RUNNING',completed:[]};this.jobs.set(job.id,job);
  void this.assistant.inspect(document,t,stage=>{if(stages.includes(stage)&&!job.completed.includes(stage))job.completed.push(stage);})
   .then(plan=>{job.plan=plan;job.state='READY';job.elapsedMs=Date.now()-Date.parse(job.startedAt);})
   .catch(()=>{job.state='FAILED';job.message='A conferência não foi concluída. Atualize para consultar novamente. Nenhum lançamento foi iniciado.';job.elapsedMs=Date.now()-Date.parse(job.startedAt);});
  return this.present(job);
 }
 async status(document:string,id:string,t:TenantContext){
  await this.assistant.authorize(t);this.cleanup();const job=this.jobs.get(id);
  if(!job||job.key!==this.key(document,t))throw new NotFoundException('Conferência expirada ou indisponível nesta sessão. Atualize o assistente; não repita lançamentos.');
  return this.present(job);
 }
}
