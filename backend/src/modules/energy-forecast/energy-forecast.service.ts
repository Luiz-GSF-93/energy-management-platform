import {BadRequestException,ConflictException,ForbiddenException,Injectable,InternalServerErrorException,NotFoundException} from '@nestjs/common';
import {ConfigService} from '@nestjs/config';
import {SupabaseService} from '../../services/supabase.service';
import {LicensesService} from '../licenses/services/licenses.service';
import {TenantContext} from '../../common/interfaces/tenant-context.interface';
import {PERMISSIONS as P} from '../../common/constants/permissions';
import {validateWriteDto} from '../../common/validation/validate-write-dto';
import {AclAdmissionService} from '../acl-admissions/acl-admission.service';
import {reportHash} from '../reports/report.projection';
import {observationsFromApprovedHistories,type ApprovedHistory} from './ocr-history-adapter';
import {calculateConsumptionForecast} from './consumption-forecast';
import {loadNasaTemperature} from './nasa-power';
import {PrepareForecastDto,TransitionForecastDto,RecordHistoryDto,ValidateHistoryDto} from './energy-forecast.dto';
import {OcrQueueService} from '../ocr/ocr-queue.service';
import {extractCpflPaulistaLayout} from '../ocr/cpfl-paulista-layout';
import {aclHistoryDraft,aclInvoiceReferenceMonth} from '../acl-admissions/acl-invoice-history';
import {decimal,quantity,monthIndex} from './consumption-forecast';
@Injectable()
export class EnergyForecastService {
 private acl:AclAdmissionService;
 constructor(private db:SupabaseService,private licenses:LicensesService,private config:ConfigService,private ocr:OcrQueueService){this.acl=new AclAdmissionService(db,licenses,config);}
 get enabled(){return this.config.get<string>('ENERGY_FORECAST_ENABLED')==='true';}
 private params(t:TenantContext){return {p_org:t.organizationId,p_actor:t.userId,p_role:t.roleId,p_platform:t.accessMode==='platform_operation'};}
 private async rpc(name:string,parameters:any){const r=await this.db.getClient().rpc(name,parameters);if(r.error){const c=r.error.code;if(c==='42501')throw new ForbiddenException('Vínculo, permissão ou licença indisponível.');if(['40001','23505'].includes(c))throw new ConflictException('Fonte ou previsão alterada. Gere uma nova versão.');if(['22023','23514','22P02'].includes(c))throw new BadRequestException('Revise as fontes e a transição.');if(['P3862','P4102'].includes(c))throw new NotFoundException('Previsão indisponível nesta organização.');throw new InternalServerErrorException('Não foi possível consultar a previsão.');}return r.data;}
 async access(t:TenantContext,write=false,source=false){
  if(!this.enabled)throw new ForbiddenException('Motor de previsão aguardando habilitação após migração e homologação.');
  if(!t?.organizationId||!t.userId||!t.permissions?.includes(P.DOCUMENTS_REPORTS_VIEW)||!t.permissions.includes(P.ORGANIZATION_CONTRACTS_VIEW)||(write&&!t.permissions.includes(P.DOCUMENTS_REPORTS_CREATE))||(!['admin_org','gestor','operacional'].includes(t.role)&&t.accessMode!=='platform_operation'))throw new ForbiddenException('Acesso ao backoffice de relatórios necessário.');
  await this.licenses.requireEntitlement(t.organizationId,'report_generation');await this.licenses.requireEntitlement(t.organizationId,'free_market_management');
  await this.rpc('assert_report_actor',{p_org:t.organizationId,p_actor:t.userId,p_write:write});
  if(source){await this.licenses.requireEntitlement(t.organizationId,'document_management');if(!t.permissions.includes(P.DOCUMENTS_VIEW))throw new ForbiddenException('A consulta de documentos exige permissão.');await this.rpc('energy_forecast_history_actor',{p_org:t.organizationId,p_actor:t.userId,p_write:write,p_approve:false});return {canApprove:t.accessMode==='platform_operation'||(['admin_org','gestor'].includes(t.role)&&t.permissions.includes(P.DOCUMENTS_UPDATE))};}
 }
 async sources(t:TenantContext){await this.access(t,false,true);const histories=await this.histories(t);let acl:any[]=[];try{const a=await this.acl.access(t);if(a.enabled)acl=await this.rpc('energy_forecast_sources',this.params(t));}catch(e){if(!(e instanceof ForbiddenException))throw e;}return [...acl,...histories.filter((h:any)=>h.reviewedAt).map((h:any)=>({historyId:h.id,customerId:h.customer_id,unitId:h.consumer_unit_id,customerName:h.customerName,unitName:h.unitName,lastMonth:h.lastMonth,reviewedAt:h.reviewedAt}))];}
 async histories(t:TenantContext){await this.access(t,false,true);return this.rpc('energy_forecast_histories',{p_org:t.organizationId,p_actor:t.userId});}
 async documents(t:TenantContext){await this.access(t,false,true);const r=await this.db.getClient().from('documents').select('id,customer_id,consumer_unit_id,original_filename,reference_month').eq('organization_id',t.organizationId).eq('document_type','INVOICE_DISTRIBUTOR').eq('file_verified',true).order('reference_month',{ascending:false}).limit(100);if(r.error)throw new InternalServerErrorException('Não foi possível consultar as faturas.');return r.data;}
 async draft(document:string,t:TenantContext){
  await this.access(t,false,true);const source=await this.rpc('energy_forecast_document_source',{p_org:t.organizationId,p_actor:t.userId,p_document:document}),ocr=await this.ocr.reviewSource(t.organizationId,document),layout=extractCpflPaulistaLayout(ocr.raw);
  if(ocr.doc.customer_id!==source.customerId||ocr.doc.consumer_unit_id!==source.unitId||ocr.doc.file_hash!==source.fileHash)throw new ConflictException('Documento alterado durante a leitura.');
  const anchor=aclInvoiceReferenceMonth(source.referenceMonth);if(!anchor)throw new BadRequestException('Competência da fatura indisponível.');
  const draft=aclHistoryDraft(layout.measurements?.history??[],anchor);
  const rows=draft.rows.map(r=>({month:r.month,consumptionKwh:r.peakKwh!==''&&r.offPeakKwh!==''?decimal(quantity(r.peakKwh)+quantity(r.offPeakKwh)):'',days:r.days,page:r.page,source:r.source}));
  return {source,sourceHash:reportHash({source,jobId:ocr.jobId,raw:ocr.raw}),rows,reviewRequired:true,message:'Confira o histórico e os dias no PDF. Campos ausentes exigem preenchimento justificado; o OCR original permanece preservado.'};
 }
 async recordHistory(input:unknown,t:TenantContext){
  await this.access(t,true,true);const d=await validateWriteDto(RecordHistoryDto,input as RecordHistoryDto);if(!d.checkedPdf)throw new BadRequestException('Confira os registros no PDF original.');
  d.rows.forEach((r,i)=>{if(r.month>=new Date().toISOString().slice(0,7)||(i>0&&monthIndex(r.month)!==monthIndex(d.rows[i-1].month)+1))throw new BadRequestException('Use competências encerradas e consecutivas.');});
  const current=await this.draft(d.documentId,t);if(current.sourceHash!==d.sourceHash)throw new ConflictException('A extração mudou. Atualize antes de conferir.');
  return this.rpc('energy_forecast_history_record',{p_org:t.organizationId,p_actor:t.userId,p_request:d.requestId,p_source:current.source,p_hash:d.sourceHash,p_rows:d.rows,p_note:d.note});
 }
 async approveHistory(id:string,input:unknown,t:TenantContext){await this.access(t,true,true);const d=await validateWriteDto(ValidateHistoryDto,input as ValidateHistoryDto);return this.rpc('energy_forecast_history_approve',{p_org:t.organizationId,p_actor:t.userId,p_history:id,p_request:d.requestId,p_note:d.note});}
 private verify(r:any,t:TenantContext){if(r.organization_id!==t.organizationId||r.body?.organizationId!==t.organizationId||r.body?.customerId!==r.customer_id||r.body?.unitId!==r.consumer_unit_id||r.payload_hash!==reportHash(r.body))throw new InternalServerErrorException('Integridade da previsão indisponível.');return r;}
 async list(t:TenantContext){await this.access(t);const rows=await this.rpc('energy_forecast_read',{p_org:t.organizationId,p_actor:t.userId,p_run:null});return rows.map((r:any)=>this.verify(r,t));}
 async one(id:string,t:TenantContext){await this.access(t);return this.verify(await this.rpc('energy_forecast_read',{p_org:t.organizationId,p_actor:t.userId,p_run:id}),t);}
 async prepare(input:unknown,t:TenantContext){
  await this.access(t,true,true);const d=await validateWriteDto(PrepareForecastDto,input as PrepareForecastDto);
  if(d.asOfMonth>=new Date().toISOString().slice(0,7))throw new BadRequestException('Selecione uma competência encerrada.');
  if(d.sources.some(s=>s.historyId?Boolean(s.admissionId||s.evidenceId):!s.admissionId||!s.evidenceId)||new Set(d.sources.map(s=>s.historyId??s.evidenceId)).size!==d.sources.length)throw new BadRequestException('Selecione fontes válidas sem repetição.');
  // Retry returns the original snapshot; never refresh weather or premise timestamps on a retry.
  const prior=await this.rpc('energy_forecast_request',{p_org:t.organizationId,p_actor:t.userId,p_request:d.requestId});
  if(prior){if(prior.created_by!==t.userId||reportHash(prior.request)!==reportHash(d))throw new ConflictException('Requisição já utilizada.');return this.verify(prior,t);}
  const sources:ApprovedHistory[]=[];for(const s of d.sources){if(s.historyId)sources.push(await this.rpc('energy_forecast_history_source',{p_org:t.organizationId,p_actor:t.userId,p_history:s.historyId}));else{const a=await this.acl.access(t);if(!a.enabled)throw new ForbiddenException('Fonte ACL indisponível.');sources.push(await this.rpc('energy_forecast_source',{...this.params(t),p_admission:s.admissionId,p_evidence:s.evidenceId}));}}
  const scope={organizationId:t.organizationId,customerId:d.customerId,unitId:d.unitId};let body;
  try{
   const observations=observationsFromApprovedHistories(scope,sources,d.asOfMonth),recordedAt=new Date().toISOString();
   const expansions=d.expansions.map((e,i)=>({...e,evidence:{...scope,id:d.requestId+':'+i,revision:1,hash:reportHash(e),recordedBy:t.userId,recordedAt,justification:e.justification}}));
   body={...calculateConsumptionForecast({...scope,asOfMonth:d.asOfMonth,observations,expansions}),weather:null as any,weatherStatus:'NOT_REQUESTED',inputVersion:reportHash({sources,expansions}),calculatedAt:recordedAt,calculatedBy:t.userId};
   if(d.weather){if(!d.weather.consent)throw new BadRequestException('Autorize a consulta meteorológica para a localização informada.');const from=observations[0].month+'-01',to=new Date(Date.UTC(Number(d.asOfMonth.slice(0,4)),Number(d.asOfMonth.slice(5)),0)).toISOString().slice(0,10);
    try{body.weather=await loadNasaTemperature(d.weather,from,to);body.weatherStatus='HISTORY_COLLECTED_NOT_APPLIED';}catch{body.weatherStatus='UNAVAILABLE';}
    body.qualifications.push('NASA POWER: histórico auxiliar; ajuste climático depende de calibração e comparação fora da amostra. Nenhum coeficiente climático foi inventado.');
   }
  }catch(e){if(e instanceof BadRequestException)throw e;throw new BadRequestException('Histórico incompleto, conflitante ou premissa inválida. Revise as fontes antes de calcular.');}
  body.inputVersion=reportHash({sources,expansions:body.expansions,weather:body.weather,weatherStatus:body.weatherStatus});
  const r=await this.rpc('energy_forecast_prepare',{...this.params(t),p_request:d,p_sources:sources,p_body:body,p_hash:reportHash(body)});
  return this.verify(r,t);
 }
 async transition(id:string,input:unknown,t:TenantContext){const a=await this.access(t,true,true);if(!a?.canApprove)throw new ForbiddenException('A validação e publicação exigem Gestor ou Administrador autorizado.');const d=await validateWriteDto(TransitionForecastDto,input as TransitionForecastDto);await this.rpc('energy_forecast_transition',{...this.params(t),p_run:id,p_request:d.requestId,p_hash:d.payloadHash,p_action:d.action,p_note:d.note});return this.one(id,t);}
 async publishedForReport(customer:string,unit:string,cutoff:string,t:TenantContext){
  if(!this.enabled)return null;await this.access(t);
  const r=await this.rpc('energy_forecast_published',{p_org:t.organizationId,p_actor:t.userId,p_customer:customer,p_unit:unit,p_cutoff:cutoff});if(!r)return null;this.verify(r,t);const b=r.body,publication=r.events.find((e:any)=>e.action==='PUBLISHED');
  if(r.customer_id!==customer||r.consumer_unit_id!==unit||b.asOfMonth!==cutoff)throw new InternalServerErrorException('Recorte da previsão incompatível com o relatório.');
  if(!publication)throw new InternalServerErrorException('Previsão sem publicação.');
  return {id:r.id,version:r.version,payloadHash:r.payload_hash,organizationId:t.organizationId,customerId:customer,unitId:unit,asOfMonth:cutoff,publishedAt:publication.created_at,formulaVersion:b.formulaVersion,inputVersion:b.inputVersion,method:b.method,actual:b.actual.map((a:any)=>({month:a.month,consumptionKwh:a.consumptionKwh,billedDays:a.billedDays})),future:b.future,observedYearKwh:b.observedYearKwh,futureKwh:b.futureKwh,estimatedYearKwh:b.estimatedYearKwh,weatherStatus:b.weatherStatus,weatherApplied:b.weatherApplied,qualifications:b.qualifications};
 }
}
