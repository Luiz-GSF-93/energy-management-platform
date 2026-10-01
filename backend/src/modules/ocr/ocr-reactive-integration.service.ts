import {classSuccessorId} from './class-parameter-successor';
import {reviewedLayoutSupported,combinedTaxLayout,operationTaxCodes} from './reviewed-layout-support';
import {Injectable,ForbiddenException,ConflictException,BadRequestException,ServiceUnavailableException} from '@nestjs/common';
import {SupabaseService} from '../../services/supabase.service';
import {TenantContext} from '../../common/interfaces/tenant-context.interface';
import {OcrMonthlyIntegrationService} from './ocr-monthly-integration.service';
import {OcrQueueService} from './ocr-queue.service';
import {OcrIdentityReviewService} from './ocr-identity-review.service';
import {OcrReviewService,ocrReviewDigest} from './ocr-review.service';
import {homologationProgress} from './homologation-progress';
import {extractCpflPaulistaLayout} from './cpfl-paulista-layout';
import {cpflReference} from './cpfl-measurements';
import {reactiveParameterCandidates} from './reactive-parameter-candidates';
import {monthPeriod} from '../contracts/services/preparation';
@Injectable()
export class OcrReactiveIntegrationService {
 constructor(private db:SupabaseService,private monthly:OcrMonthlyIntegrationService,private queue:OcrQueueService,private identity:OcrIdentityReviewService,private consumption:OcrReviewService){}
 private fail(e:any){if(!e)return;if(['P4090','P4091','40001','23505','P3402'].includes(e.code))throw new ConflictException('A fonte ou os registros mudaram. Atualize a integração; o histórico foi preservado.');throw new ServiceUnavailableException('Não foi possível consultar ou integrar os reativos. Atualize a situação.');}
 private async context(document:string,t:TenantContext){
  await this.monthly.preview(document,t);
  const db=this.db.getClient(),source=await this.queue.reviewSource(t.organizationId,document),layout=extractCpflPaulistaLayout(source.raw),month=String(source.doc.reference_month).slice(0,7),period=monthPeriod(month);
  const [identity,consumption,monthly,parameters,saved]=await Promise.all([this.identity.list(t.organizationId,document),this.consumption.list(t.organizationId,document),db.from('calculation_monthly_inputs').select('*').eq('organization_id',t.organizationId).eq('consumer_unit_id',source.doc.consumer_unit_id).eq('month',month).order('version',{ascending:false}).limit(1),db.from('calculation_parameters').select('*').eq('organization_id',t.organizationId).eq('consumer_unit_id',source.doc.consumer_unit_id).eq('scenario','ACL').eq('kind','TARIFF').eq('component_code','REACTIVE').range(0,999),db.from('document_ocr_reactive_integrations').select('*').eq('organization_id',t.organizationId).eq('document_id',document).maybeSingle()]);
  [monthly,parameters,saved].forEach(r=>this.fail(r.error));if(!Array.isArray(monthly.data)||!Array.isArray(parameters.data)||parameters.data.length>=1000)this.fail(true);
  const current=monthly.data[0],refs=(fields:any[])=>Object.fromEntries(fields.map(f=>[f.key,{id:f.history[0]?.id??null,sourceHash:f.sourceHash}])),reviewRefs={identity:refs(identity.fields),consumption:refs(consumption.fields)};
  const groups=homologationProgress(identity.fields,consumption.fields,[]).groups,candidates=reactiveParameterCandidates(layout.operations,layout.layoutId),reference=[...new Set(layout.fields.filter(f=>f.name==='reference').map(f=>cpflReference(f.value.text)))];
  const ready=groups[0].complete&&groups[1].complete&&reviewedLayoutSupported(layout.layoutId)&&layout.reconciliation.state==='MATCH'&&reference.length===1&&reference[0]===month&&candidates.length>0&&candidates.every(c=>c.ready)&&(layout.layoutId!=='neoenergia-elektro-verde'||(combinedTaxLayout(layout)&&candidates.every(c=>operationTaxCodes(layout.operations.find(r=>r.source===c.source),true).length===3)));
  const scope=current?.customer_id===source.doc.customer_id&&current?.unit_context?.tariff_group==='A'&&current?.unit_context?.free_market===true;
  const overlaps=parameters.data.filter((p:any)=>p.status!=='RETIRED'&&p.start_date<=period.end&&p.end_date>=period.start);
  const state=saved.data?'INTEGRATED':!current?'MONTHLY_REQUIRED':!scope?'UNSUPPORTED':overlaps.length||current.measurements?.reactiveTotal!=null||current.measurements?.reactiveBilledPeakKwh!=null||current.measurements?.reactiveBilledOffPeakKwh!=null?'RECORD_PRESERVED':ready?'READY':'REVIEW_REQUIRED';
  const evidence=candidates.map(c=>{const row=layout.operations.find(r=>r.source===c.source);return {band:c.band,source:c.source,icms:row?.fields.icmsAmount?.decimal??null,pis:row?.fields.pisAmount?.decimal??null,cofins:row?.fields.cofinsAmount?.decimal??null,pisCofins:row?.fields.pisCofinsAmount?.decimal??null,layoutId:layout.layoutId};});
  const token=ocrReviewDigest({document,job:source.jobId,fileHash:source.doc.file_hash,reviewRefs,candidates,current,overlaps,evidence});
  const messages:Record<string,string>={INTEGRATED:'Reativos integrados. Valide a versão mensal e aprove as tarifas ACL; as tarifas ACR existentes serão aplicadas às mesmas quantidades.',MONTHLY_REQUIRED:'Integre primeiro os consumos da fatura.',UNSUPPORTED:'Disponível para os layouts homologáveis CPFL Paulista e Neoenergia Elektro Grupo A ACL.',RECORD_PRESERVED:'Já existem quantidades ou tarifas de reativo. Use revisão auditada; nenhum registro será substituído.',REVIEW_REQUIRED:'Confira a identidade, os consumos e as evidências de quantidade, tarifa e valor dos reativos.',READY:'Serão preenchidos os reativos por posto em kWh da fatura e criadas as tarifas ACL dos postos documentados em rascunho. Posto ausente permanece não informado. Versões validadas serão preservadas.'};
  return {source,current,reviewRefs,candidates,evidence,preview:{token,state,canCreate:state==='READY'&&this.monthly.canWrite(t),message:messages[state],inputId:saved.data?.input_id??null,parameterIds:(saved.data?.parameter_ids??[]).map((id:string)=>classSuccessorId(id,parameters.data)),month,candidates,evidence,targetVersion:saved.data?.source_snapshot?.targetVersion??(current?.version+(current?.status==='VALIDATED'?1:0))}};
 }
 async preview(document:string,t:TenantContext){return (await this.context(document,t)).preview;}
 async create(document:string,t:TenantContext,body:any){
  if(!this.monthly.canWrite(t))throw new ForbiddenException('A integração exige Gestor ou Administrador com permissão de cadastro.');
  if(!body||Array.isArray(body)||Object.keys(body).length!==1||typeof body.token!=='string'||!/^[a-f0-9]{64}$/.test(body.token))throw new BadRequestException('Atualize a prévia antes de integrar.');
  const c=await this.context(document,t);if(c.preview.state==='INTEGRATED')return {alreadyIntegrated:true,inputId:c.preview.inputId,parameterIds:c.preview.parameterIds};
  if(body.token!==c.preview.token)throw new ConflictException('A prévia mudou. Atualize a integração.');if(!c.preview.canCreate)throw new ConflictException(c.preview.message);
  const r=await this.db.getClient().rpc('integrate_ocr_reactive',{p_org:t.organizationId,p_document:document,p_actor:t.userId,p_input:c.current.id,p_revision:c.current.revision,p_refs:c.reviewRefs,p_job:c.source.jobId,p_file_hash:c.source.doc.file_hash,p_rows:c.candidates,p_evidence:c.evidence});this.fail(r.error);if(!r.data?.inputId)this.fail({});return r.data;
 }
}
