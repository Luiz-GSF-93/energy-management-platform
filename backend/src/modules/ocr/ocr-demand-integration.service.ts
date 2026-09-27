import {Injectable,ForbiddenException,ConflictException,BadRequestException,ServiceUnavailableException} from '@nestjs/common';
import {SupabaseService} from '../../services/supabase.service';
import {TenantContext} from '../../common/interfaces/tenant-context.interface';
import {OcrMonthlyIntegrationService} from './ocr-monthly-integration.service';
import {OcrDemandReviewService} from './ocr-demand-review.service';
import {ocrReviewDigest} from './ocr-review.service';
import {reviewedDemandSummary} from './reviewed-demand-summary';
@Injectable()
export class OcrDemandIntegrationService {
 constructor(private db:SupabaseService,private monthly:OcrMonthlyIntegrationService,private demand:OcrDemandReviewService){}
 private fail(e:any){if(!e)return;if(['P4090','P4091','40001','23505'].includes(e.code))throw new ConflictException('O rascunho, o cadastro ou as conferências mudaram. Atualize a integração; nenhum valor existente foi substituído.');throw new ServiceUnavailableException('Não foi possível consultar ou integrar a demanda faturada. Atualize a situação antes de tentar novamente.');}
 private async context(document:string,t:TenantContext){
  await this.monthly.preview(document,t); // Enforces tenant, document/contract permissions and both entitlements.
  const client=this.db.getClient(),org=t.organizationId;
  const [reviews,saved,origin]=await Promise.all([this.demand.list(org,document),client.from('document_ocr_demand_integrations').select('input_id,created_at').eq('organization_id',org).eq('document_id',document).maybeSingle(),client.from('document_ocr_monthly_integrations').select('input_id,source_snapshot').eq('organization_id',org).eq('document_id',document).maybeSingle()]);
  this.fail(saved.error);this.fail(origin.error);
  let input:any=null;if(origin.data){const r=await client.from('calculation_monthly_inputs').select('id,status,revision,billed_demand,measurements,unit_context').eq('organization_id',org).eq('id',origin.data.input_id).maybeSingle();this.fail(r.error);input=r.data;}
  const summary=reviewedDemandSummary(reviews.fields),refs=Object.fromEntries(reviews.fields.map(f=>[f.key,{id:f.history[0]?.id??null,sourceHash:f.sourceHash}]));
  const eligible=summary.state==='COMPLETE'&&reviews.fields.every(f=>f.period==='UNSPECIFIED'&&typeof f.decimal==='string'&&/^(0|[1-9][0-9]{0,11})([.][0-9]{1,6})?$/.test(f.decimal));
  const supported=input?.unit_context?.tariff_group==='A'&&input?.unit_context?.tariff_modality==='GREEN'&&input?.unit_context?.free_market===true;
  const unchanged=input&&ocrReviewDigest(input.measurements)===ocrReviewDigest(origin.data.source_snapshot.measurements);
  const state=saved.data?'INTEGRATED':!origin.data?'CONSUMPTION_REQUIRED':!supported?'UNSUPPORTED':input?.status!=='DRAFT'||input.billed_demand!==null||!unchanged?'RECORD_PRESERVED':!eligible?'REVIEWS_PENDING':'READY';
  const token=ocrReviewDigest({document,refs,revision:input?.revision??null});
  const messages:Record<string,string>={INTEGRATED:'Integração registrada no histórico de Dados mensais. Edições posteriores são consultadas nessa versão.',CONSUMPTION_REQUIRED:'Integre primeiro os consumos conferidos para criar o rascunho mensal.',UNSUPPORTED:'Esta etapa atende demanda única do Grupo A Verde no ACL. Outros enquadramentos exigem mapeamento específico.',RECORD_PRESERVED:'Registro alterado, validado ou com demanda faturada já preenchida. Nenhum valor será substituído.',REVIEWS_PENDING:'Confira todas as parcelas faturadas da evidência atual antes de integrar.',READY:'As parcelas conferidas serão somadas somente na demanda faturável ACL do mesmo rascunho.'};
  return {refs,revision:input?.revision,preview:{token,state,canCreate:state==='READY'&&this.monthly.canWrite(t),inputId:saved.data?.input_id??input?.id??null,usedKw:summary.usedKw,unusedKw:summary.unusedKw,month:origin.data?.source_snapshot?.month??null,message:messages[state]}};
 }
 async preview(document:string,t:TenantContext){return (await this.context(document,t)).preview;}
 async create(document:string,t:TenantContext,body:any){
  if(!this.monthly.canWrite(t))throw new ForbiddenException('A integração exige Gestor ou Administrador com permissão para criar dados mensais.');
  if(!body||Array.isArray(body)||Object.keys(body).length!==1||typeof body.token!=='string'||!/^[a-f0-9]{64}$/.test(body.token))throw new BadRequestException('Atualize a prévia antes de integrar.');
  const c=await this.context(document,t);if(c.preview.state==='INTEGRATED')return {inputId:c.preview.inputId,alreadyIntegrated:true};
  if(body.token!==c.preview.token)throw new ConflictException('A prévia mudou. Atualize a integração.');if(!c.preview.canCreate)throw new ConflictException(c.preview.message);
  const r=await this.db.getClient().rpc('integrate_ocr_billed_demand',{p_org:t.organizationId,p_document:document,p_actor:t.userId,p_refs:c.refs,p_revision:c.revision});this.fail(r.error);if(!r.data?.inputId)this.fail({});return r.data;
 }
}
