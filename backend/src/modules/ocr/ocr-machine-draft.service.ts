import {Injectable,ForbiddenException,ServiceUnavailableException} from '@nestjs/common';
import {SupabaseService} from '../../services/supabase.service';
import {TenantContext} from '../../common/interfaces/tenant-context.interface';
import {ocrDraftPermission,ocrDraftRole} from './ocr-draft-access';
import {AiReview} from './backoffice-ai.service';

export function machineDraftFields(plan:any,review?:AiReview){
 const evidence=new Map((review?.evidence??[]).map(e=>[e.id,e]));
 return (plan.fieldTasks??[]).filter((f:any)=>!f.confirmed&&typeof f.value==='string'&&f.value.trim()&&/^[a-f0-9]{64}$/.test(f.sourceHash)&&typeof f.source==='string'&&f.source.trim()).map((f:any)=>{
  const key=f.kind+':'+f.key;
  const inferred=review?.state==='READY'&&review.fields?.some(v=>v.key===key&&v.value===f.value&&evidence.get(v.evidenceId)?.fieldKey===key&&evidence.get(v.evidenceId)?.value===f.value);
  return {key,value:f.value,source:f.source,sourceHash:f.sourceHash,quality:!f.canConfirm?'REVIEW_REQUIRED':'EXTRACTED_DRAFT',interpreted:!!inferred,doubts:(review?.doubts??[]).filter(d=>d.evidenceIds.some(id=>evidence.get(id)?.fieldKey===key)).map(d=>d.question)};
 });
}
@Injectable()
export class OcrMachineDraftService {
 constructor(private db:SupabaseService){}
 async fill(t:TenantContext,plan:any,review?:AiReview){
  if(!ocrDraftRole(t)||!ocrDraftPermission(t))throw new ForbiddenException('Preenchimento exige permissão de rascunhos.');
  const fields=machineDraftFields(plan,review);
  if(!fields.length)return {state:'NO_FIELDS',count:0,message:'Sem novos campos comprovados para preencher.'};
  const {data,error}=await this.db.getClient().rpc('save_bot_energy_ocr_draft',{p_organization:t.organizationId,p_actor:t.userId,p_document:plan.documentId,p_basis:plan.basis,p_fields:fields});
  if(error||data!==true)throw new ServiceUnavailableException('Não foi possível salvar o preenchimento automático. Atualize para conferir os registros.');
  return {state:'FILLED_DRAFT',count:fields.length,message:'Campos preenchidos e salvos em rascunho. Dúvidas permanecem destacadas junto aos valores; confirmação pelo Expert e aprovação financeira seguem identificadas.'};
 }
}
