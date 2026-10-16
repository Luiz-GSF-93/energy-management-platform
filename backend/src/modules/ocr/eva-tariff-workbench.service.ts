import {BadRequestException,ConflictException,ForbiddenException,Injectable,ServiceUnavailableException,Optional} from '@nestjs/common';
import {randomUUID} from 'node:crypto';
import {BackofficeAiService} from './backoffice-ai.service';
import {ConfigService} from '@nestjs/config';
import {SupabaseService} from '../../services/supabase.service';
import {TenantContext} from '../../common/interfaces/tenant-context.interface';
import {OcrQueueService} from './ocr-queue.service';
import {modelConfidence} from './eva-tariff-workbench.model';
import {globalModelConfidence,globalPreparationEvidence,verifiedGlobalPreparation} from './eva-global-model';
import {tariffCandidates,tariffMatrix} from './eva-tariff-workbench.model';
import {LibraryWriteDto} from '../contracts/dto/tariff-library.dto';
import {validateWriteDto} from '../../common/validation/validate-write-dto';
import {validateProfile} from '../contracts/services/tariff-library-plan';
import {autofillHash} from './calculation-autofill.model';
const modelKey=(u:any)=>autofillHash([u.distributor,u.tariff_group,u.tariff_subgroup,u.tariff_modality].map(v=>String(v??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toUpperCase().replace(/[^A-Z0-9]/g,'')));
const uuid=(v:unknown)=>typeof v==='string'&&/^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(v);
@Injectable()
export class EvaTariffWorkbenchService{
 constructor(private db:SupabaseService,private config:ConfigService,private queue:OcrQueueService,@Optional() private ai?:BackofficeAiService){}
 enabled(){return this.config.get('EVA_TARIFF_WORKBENCH_ENABLED')==='true';}
 private scope(q:any){if(!q||Object.keys(q).sort().join(',')!=='consumerUnitId,month'||!uuid(q.consumerUnitId)||typeof q.month!=='string'||!/^(20|21)\d{2}-(0[1-9]|1[0-2])$/.test(q.month))throw new BadRequestException('Selecione unidade e competência.');return q;}
 private async rpc(action:string,q:any,t:TenantContext,id:string|null,body:any){
  if(!t?.organizationId||!t.userId||!t.roleId)throw new ForbiddenException('Contexto necessário.');
  const r=await this.db.getClient().rpc('eva_tariff_workbench_action',{p_org:t.organizationId,p_actor:t.userId,p_role:t.roleId,p_platform:t.accessMode==='platform_operation',p_action:action,p_unit:q.consumerUnitId,p_month:q.month,p_id:id,p_body:body});
  if(!r.error&&r.data!=null)return r.data;
  if(r.error?.code==='42501')throw new ForbiddenException('Biblioteca restrita ao backoffice autorizado.');
  if(['40001','23505'].includes(r.error?.code))throw new ConflictException('A fonte ou versão mudou. Consulte o histórico antes de repetir.');
  if(r.error?.code==='22023')throw new BadRequestException('Confira os campos e a fonte.');
  throw new ServiceUnavailableException('Resultado não confirmado. Consulte o histórico antes de repetir.');
 }
 async inspect(q:any,t:TenantContext){if(!this.enabled())return {enabled:false};const {page='0',...s}=q;this.scope(s);if(typeof page!=='string'||!/^\d{1,3}$/.test(page))throw new BadRequestException('Página inválida.');return {enabled:true,globalScoreEnabled:this.config.get('EVA_OCR_GLOBAL_PREPARATION_ENABLED')==='true',callsEnabled:this.config.get('EVA_TARIFF_MODEL_CALLS_ENABLED')==='true',...await this.rpc('inspect',s,t,null,{page:Number(page)})};}
 async command(b:any,t:TenantContext){
  if(!this.enabled())throw new ServiceUnavailableException('Biblioteca ampliada desligada.');
  if(!b||Object.keys(b).sort().join(',')!=='action,consumerUnitId,data,month,requestId'||!uuid(b.requestId))throw new BadRequestException('Comando inválido.');
  const s=this.scope({consumerUnitId:b.consumerUnitId,month:b.month});
  if(!['import','review','enqueue','qualify'].includes(b.action))throw new BadRequestException('Ação inválida.');
  // Authorization is checked again inside every mutating transaction.
  const access=await this.rpc('inspect',s,t,null,{page:0});if(!access.canWrite)throw new ForbiddenException('Sem permissão para cadastrar biblioteca.');
  let payload:any;
  if(b.action==='enqueue'){
   if(this.config.get('EVA_TARIFF_MODEL_CALLS_ENABLED')!=='true')throw new ServiceUnavailableException('Leitura paga de modelos desligada.');
   if(!b.data||Object.keys(b.data).join(',')!=='documentId'||!uuid(b.data.documentId))throw new BadRequestException('Documento inválido.');
   await this.rpc('checkDocument',s,t,null,b.data);
   const current=await this.queue.status(t.organizationId,b.data.documentId);if(current.job)return current.job;
   const u=await this.db.getClient().from('consumer_units').select('*').eq('id',s.consumerUnitId).eq('organization_id',t.organizationId).maybeSingle();if(u.error||!u.data)throw new ForbiddenException('Unidade indisponível.');
   const payload={documentId:b.data.documentId,modelKey:modelKey(u.data)};
   const reservation=await this.rpc('reserveModel',s,t,b.requestId,{payload,hash:autofillHash(payload)});
   if(!reservation.acquired)throw new ConflictException('Processamento já reservado. Consulte o histórico antes de repetir.');
   return this.queue.enqueue(t.organizationId,b.data.documentId,t.userId);
  }
  if(b.action==='qualify'){
   if(!b.data||Object.keys(b.data).sort().join(',')!=='acknowledge,importId,note'||!uuid(b.data.importId)||b.data.acknowledge!==true||typeof b.data.note!=='string'||b.data.note.trim().length<20||b.data.note.length>1500)throw new BadRequestException('Confira o modelo e justifique a decisão.');
   payload=b.data;
   const selected=access.imports?.find((i:any)=>i.id===b.data.importId);
   if(selected?.payload?.evaluation?.version===2&&this.config.get('EVA_OCR_GLOBAL_PREPARATION_ENABLED')!=='true')throw new ServiceUnavailableException('Revisão global desligada; histórico preservado.');
  }else if(b.action==='import'){
   if(!b.data||Object.keys(b.data).sort().join(',')!=='documentId,reason,threshold'||!uuid(b.data.documentId)||typeof b.data.threshold!=='number'||b.data.threshold<0.9||b.data.threshold>1||typeof b.data.reason!=='string'||b.data.reason.trim().length<20||b.data.reason.length>1500)throw new BadRequestException('Informe documento, limiar mínimo de 90% e motivo da revisão.');
   await this.rpc('checkDocument',s,t,null,{documentId:b.data.documentId});
   const source=await this.queue.reviewSource(t.organizationId,b.data.documentId);
   if(source.doc.consumer_unit_id!==s.consumerUnitId||String(source.doc.reference_month).slice(0,7)!==s.month)throw new BadRequestException('Documento fora da seleção.');
   const u=await this.db.getClient().from('consumer_units').select('*').eq('id',s.consumerUnitId).eq('organization_id',t.organizationId).maybeSingle();
   if(u.error||!u.data)throw new ForbiddenException('Unidade indisponível.');
   const c={unit:u.data,document:source.doc,source};
   const evaluation=this.config.get('EVA_OCR_GLOBAL_PREPARATION_ENABLED')==='true'?globalModelConfidence(source.raw,b.data.threshold,u.data):modelConfidence(source.raw,b.data.threshold,u.data);
   const mismatches=source.assessment?.intake?.checks?.filter((x:any)=>x.state==='MISMATCH')??[];
   if(mismatches.length){evaluation.consistent=false;evaluation.state='NEEDS_REVISION';}
   payload={...tariffCandidates(c),modelKey:modelKey(u.data),evaluation:{...evaluation,intakeChecks:source.assessment?.intake?.checks??[]},reason:b.data.reason.trim()};
   if(payload.evaluation.version===2)payload.preparation=verifiedGlobalPreparation(globalPreparationEvidence(payload.evaluation,200),null);
  }else if(b.action==='review'){
   if(!b.data||Object.keys(b.data).sort().join(',')!=='importId,library,reason'||!uuid(b.data.importId)||typeof b.data.reason!=='string'||b.data.reason.trim().length<20||b.data.reason.length>1500)throw new BadRequestException('Informe justificativa e revisão.');
   const library=await validateWriteDto(LibraryWriteDto,b.data.library);validateProfile(library);
   payload={importId:b.data.importId,library,reason:b.data.reason.trim()};
  }
  const result=await this.rpc(b.action,s,t,b.requestId,{payload,hash:autofillHash(payload)});
  if(b.action==='import'&&!result.replayed&&this.config.get('EVA_TARIFF_MODEL_CALLS_ENABLED')==='true'&&this.ai){
   const reservationId=randomUUID(),intent={importId:b.requestId};
   const reserved=await this.rpc('adviceReserve',s,t,reservationId,{payload:intent,hash:autofillHash(intent)});
   if(reserved.acquired){
    let advice:any;try{
     const global=payload.evaluation.version===2;
     const evidence=global?globalPreparationEvidence(payload.evaluation):[];
     const context={id:'model',label:'Avaliação OCR e consistência',value:JSON.stringify(global?{version:2,score:payload.evaluation.score,completion:payload.evaluation.completion,consistent:payload.evaluation.consistent,state:payload.evaluation.state}:payload),source:'Modelo privado '+b.requestId+'; evidência documental não confiável'};
     if(Buffer.byteLength(JSON.stringify([context,...evidence]))>40000)throw Error('Contexto extenso; revisar modelo sem chamada paga.');
     advice=await this.ai.interpret(t,global?'Prepare fields estruturados das fontes individuais, preservando exatamente key, value e evidenceId. Não calcule nem invente valores. Resuma o score global e lacunas, sem exigir 90% por campo ou seção. Referências não elevam confiança OCR.':'Avalie a qualidade deste modelo de fatura. Não aumente o score OCR nem invente campos. Explique os campos essenciais insuficientes e recomendações para a próxima revisão.',[context,...evidence],b.data.documentId,'OCR');
     if(global)advice={...advice,preparation:verifiedGlobalPreparation(evidence,advice)};
    }catch{advice={state:'FAILED',message:'Análise não confirmada; não repetir automaticamente.'};}
    const completed={importId:b.requestId,reservationId,advice};await this.rpc('adviceFinish',s,t,randomUUID(),{payload:completed,hash:autofillHash(completed)});
   }
  }
  return result;
 }
}
