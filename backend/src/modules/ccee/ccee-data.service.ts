import {BadRequestException,ConflictException,ForbiddenException,Injectable,ServiceUnavailableException} from '@nestjs/common';
import {invoiceConsumption,measurementCsv,reconcileConsumption,reconciliationSummary,verifiedInvoiceBasis} from './ccee-reconciliation';
import {createHash} from 'node:crypto';
import {SupabaseService} from '../../services/supabase.service';
import {LicensesService} from '../licenses/services/licenses.service';
import {TenantContext} from '../../common/interfaces/tenant-context.interface';
import {PERMISSIONS} from '../../common/constants/permissions';
import {cceeCalculationDraft} from './ccee-calculation-routing';
import {CCEE_DATA_FLAGS,CCEE_DATA_PERMISSIONS,cceeDataEnabled,cceeMonth,cceeObject,cceeText,cceeUuid,dateOnly,readingCommand,calendarSource} from './ccee-data.model';
import {calendarMapping,downloadCalendar,isolatedCalendar,mappedCalendar} from './ccee-calendar';
@Injectable()
export class CceeDataService{
 constructor(private db:SupabaseService,private licenses:LicensesService){}
 private async allowed(t:TenantContext,action:keyof typeof CCEE_DATA_PERMISSIONS='view'){
  if(!t?.userId||!t.organizationId||(t.scope as string)==='global'||!['admin_org','gestor','operacional'].includes(t.role)&&t.accessMode!=='platform_operation')throw new ForbiddenException('Leituras CCEE exigem backoffice organizacional.');
  if(t.accessMode!=='platform_operation'&&(!t.permissions.includes(CCEE_DATA_PERMISSIONS.view)||!t.permissions.includes(CCEE_DATA_PERMISSIONS[action])))throw new ForbiddenException('Permissão CCEE ausente.');
  if(action==='review'&&!['admin_org','gestor'].includes(t.role)&&t.accessMode!=='platform_operation')throw new ForbiddenException('Revisão exige Gestor ou Administrador.');
  await this.licenses.requireEntitlement(t.organizationId,'free_market_management');
 }
 async rpc(name:string,args:Record<string,unknown>){
  const{data,error}=await this.db.getClient().rpc(name,args);
  if(error?.code==='42501')throw new ForbiddenException('Reconfira perfil, licença, representação, unidade e vigência CCEE.');
  if(['40001','23505'].includes(error?.code??''))throw new ConflictException('A revisão ou solicitação mudou. Confira o histórico antes de repetir.');
  if(['22023','23514','23502','22P02'].includes(error?.code??''))throw new BadRequestException('Confira campos, período e cobertura da fonte CCEE.');
  if(error||data===null)throw new ServiceUnavailableException('Resultado CCEE não confirmado. Consulte o histórico antes de repetir.');return data;
 }
 private action(t:TenantContext,action:string,id:string|null,body:object){return this.rpc('ccee_data_action',{p_org:t.organizationId,p_actor:t.userId,p_action:action,p_id:id,p_body:body});}
 async workspace(t:TenantContext,page=0){
  await this.allowed(t);if(!Number.isInteger(page)||page<0||page>1000)throw new BadRequestException('Página inválida.');
  const flags=Object.fromEntries([...CCEE_DATA_FLAGS,'CCEE_RECONCILIATION_ENABLED'].map(k=>[k,process.env[k]==='true']));
  if(!flags.CCEE_DATA_WORKSPACE_ENABLED)return{organizationId:t.organizationId,enabled:false,flags,bindings:[],jobs:[],page,canManage:false,canReview:false};
  const data=await this.action(t,'list',null,{page});
  return{...data,enabled:true,flags,canManage:t.accessMode==='platform_operation'||t.permissions.includes(CCEE_DATA_PERMISSIONS.manage),canReview:t.accessMode==='platform_operation'||['admin_org','gestor'].includes(t.role)&&t.permissions.includes(CCEE_DATA_PERMISSIONS.review)};
 }
 async binding(t:TenantContext,input:unknown){
  cceeDataEnabled('CCEE_DATA_WORKSPACE_ENABLED');await this.allowed(t,'manage');
  const b=cceeObject(input,['requestId','customerId','unitId','profileCode','principalProfileCode','measurementPoint','representationKind','serviceScope','validFrom','validTo','measurementBasis','evidenceReference','reason'],['meterCode']);
  cceeUuid(b.requestId);cceeUuid(b.customerId);cceeUuid(b.unitId);dateOnly(b.validFrom);if(b.validTo)dateOnly(b.validTo);
  if(!Array.isArray(b.serviceScope)||b.serviceScope.length<1||b.serviceScope.length>3||new Set(b.serviceScope).size!==b.serviceScope.length||b.serviceScope.some((s:any)=>!['POINTS','MEASUREMENTS','AGENDA'].includes(s)))throw new BadRequestException('Selecione os serviços efetivamente autorizados.');
  if(!/^\d{1,12}$/.test(b.profileCode)||b.principalProfileCode&&!/^\d{1,12}$/.test(b.principalProfileCode)||b.serviceScope.includes('MEASUREMENTS')&&!/^\d{1,12}$/.test(b.principalProfileCode)||!/^[-A-Za-z0-9_]{1,100}$/.test(b.measurementPoint)||b.meterCode&&!/^[-A-Za-z0-9_]{1,100}$/.test(b.meterCode)||!['TOTAL','PARTIAL'].includes(b.representationKind)||!['UNKNOWN','NO_LOSSES','WITH_LOSSES'].includes(b.measurementBasis))throw new BadRequestException('Confira perfil principal, ponto e escopo de representação.');
  cceeText(b.evidenceReference,2000,10);cceeText(b.reason);return this.action(t,'binding',null,b);
 }
 async reviewBinding(t:TenantContext,id:string,action:string,input:unknown){
  cceeDataEnabled('CCEE_DATA_WORKSPACE_ENABLED');await this.allowed(t,'review');cceeUuid(id);
  if(!['approve_binding','revoke_binding'].includes(action))throw new BadRequestException('Decisão inválida.');
  const b=cceeObject(input,['requestId','revision','reason']);cceeUuid(b.requestId);cceeText(b.reason);if(!Number.isInteger(b.revision)||b.revision<1)throw new BadRequestException('Revisão inválida.');return this.action(t,action,id,b);
 }
 async enqueue(t:TenantContext,input:unknown){
  cceeDataEnabled('CCEE_DATA_WORKSPACE_ENABLED');await this.allowed(t,'manage');const b=readingCommand(input);
  if(b.kind!=='PLD')cceeDataEnabled('CCEE_PRIVATE_READ_ENABLED');
  if(b.kind==='PLD'&&t.organizationId!==process.env.CCEE_ORGANIZATION_ID)throw new ForbiddenException('PLD de referência vinculado à organização configurada.');
  return this.action(t,'enqueue',null,b);
 }
 async job(t:TenantContext,id:string){
  cceeDataEnabled('CCEE_DATA_WORKSPACE_ENABLED');await this.allowed(t);const result=await this.action(t,'job',cceeUuid(id),{});
  if(process.env.CCEE_READING_DIAGNOSTICS_ENABLED==='true'&&result.job.state==='FAILED'){
   const history=await this.action(t,'history',id,{page:0}),event=history.rows.find((e:any)=>e.event==='READ_FAILED');
   if(event)result.diagnostic={at:event.recorded_at,errorCode:result.job.error_code,requests:result.job.requests,bytes:result.job.bytes,durationMs:result.job.duration_ms,httpStatus:event.details.httpStatus??null,transactions:event.details.transactions??[],hashes:event.details.hashes??[]};
  }
  return result;
 }
 async history(t:TenantContext,id:string|undefined,page=0){cceeDataEnabled('CCEE_DATA_WORKSPACE_ENABLED');await this.allowed(t);if(!Number.isInteger(page)||page<0||page>1000)throw new BadRequestException('Página inválida.');return this.action(t,'history',id?cceeUuid(id):null,{page});}
 async cancel(t:TenantContext,id:string,input:unknown){cceeDataEnabled('CCEE_DATA_WORKSPACE_ENABLED');await this.allowed(t,'manage');const b=cceeObject(input,['requestId']);cceeUuid(b.requestId);return this.action(t,'cancel',cceeUuid(id),b);}
 async preparation(t:TenantContext,id:string){
  cceeDataEnabled('CCEE_DATA_WORKSPACE_ENABLED');await this.allowed(t,'manage');
  const data=await this.action(t,'preparation',cceeUuid(id),{}),j=data.job;
  if(j.state!=='SUCCEEDED'||j.kind!=='MEASUREMENTS'||!j.result?.record)throw new BadRequestException('A leitura ainda não possui cobertura integral conferida.');
  const draft=cceeCalculationDraft(j.result.record,j.result.record.binding);
  return{organizationId:t.organizationId,jobId:j.id,draft,notice:'Prévia para conciliação com a fatura. Não salva, valida ou substitui dados mensais.'};
 }
 async applyPreparation(t:TenantContext,id:string,input:unknown){
  const b=cceeObject(input,['requestId','reason']);cceeUuid(b.requestId);cceeText(b.reason);
  if(!t.permissions.includes(PERMISSIONS.ORGANIZATION_CONTRACTS_UPDATE))throw new ForbiddenException('Preparar dados mensais exige permissão de contratos.');
  const prepared=await this.preparation(t,id),draft=prepared.draft;
  if(draft.type!=='MEASUREMENTS')throw new BadRequestException('Origem incompatível.');
  // The existing monthly service creates only a draft and rejects conflicting/duplicate drafts.
  return this.rpc('ccee_prepare_data_monthly',{p_org:t.organizationId,p_actor:t.userId,p_job:id,p_request:b.requestId,p_reason:b.reason});
 }
 async calendar(t:TenantContext,versionId:string|undefined,page=0){
  cceeDataEnabled('CCEE_OFFICIAL_CALENDAR_ENABLED');cceeDataEnabled('CCEE_DATA_WORKSPACE_ENABLED');await this.allowed(t);
  if(versionId)cceeUuid(versionId);if(!Number.isInteger(page)||page<0||page>1000)throw new BadRequestException('Página inválida.');
  return this.action(t,'calendar',null,{page,...(versionId?{versionId}:{})});
 }
 async applyCalendar(t:TenantContext,input:unknown){
  await this.allowed(t,'manage');const b=cceeObject(input,['versionId','itemId','bindingId','responsibleId','reason']);cceeUuid(b.itemId);cceeUuid(b.bindingId);cceeText(b.responsibleId,100,1);cceeText(b.reason);
  // Authoritative read checks the exact item, active version and private binding again.
  cceeDataEnabled('CCEE_OFFICIAL_CALENDAR_ENABLED');cceeDataEnabled('CCEE_DATA_WORKSPACE_ENABLED');
  return this.rpc('ccee_apply_calendar',{p_org:t.organizationId,p_actor:t.userId,p_version:cceeUuid(b.versionId),p_item:b.itemId,p_binding:b.bindingId,p_responsible:b.responsibleId,p_reason:b.reason});
 }
 async ownerCalendar(actor:string,action:string,id:string|null,body:unknown){
  if(action==='list'&&process.env.CCEE_OFFICIAL_CALENDAR_ENABLED!=='true')return{enabled:false,versions:[],items:[]};
  cceeDataEnabled('CCEE_OFFICIAL_CALENDAR_ENABLED');
  return this.rpc('ccee_calendar_action',{p_actor:actor,p_action:action,p_id:id,p_body:body});
 }
 async collectCalendar(actor:string,input:unknown){
  cceeDataEnabled('CCEE_OFFICIAL_CALENDAR_ENABLED');
  // Require a current Owner in the database before any download or parser process starts.
  await this.ownerCalendar(actor,'list',null,{page:0});
  const b=cceeObject(input,['requestId','sourceUrl','mapping','reason']);cceeUuid(b.requestId);const sourceUrl=calendarSource(b.sourceUrl),mapping=calendarMapping(b.mapping);cceeText(b.reason,1000);
  const bytes=await downloadCalendar(sourceUrl),grid=await isolatedCalendar(bytes),parsed=mappedCalendar(grid,mapping),sourceHash=createHash('sha256').update(bytes).digest('hex');
  const normalizedHash=createHash('sha256').update(JSON.stringify({mapping,...parsed})).digest('hex');
  return this.ownerCalendar(actor,'create',null,{requestId:b.requestId,sourceUrl,sourceHash,normalizedHash,year:mapping.year,mapping,coverage:parsed.coverage,issues:parsed.issues,items:parsed.items,reason:b.reason});
 }
 private reconciliationEnabled(){cceeDataEnabled('CCEE_DATA_WORKSPACE_ENABLED');if(process.env.CCEE_RECONCILIATION_ENABLED!=='true')throw new ServiceUnavailableException('Conciliação CCEE × fatura desligada; aguardando homologação.');}
 private async invoiceAccess(t:TenantContext,manage=false){
  await this.allowed(t,manage?'manage':'view');
  if(t.accessMode!=='platform_operation'&&!t.permissions.includes(PERMISSIONS.DOCUMENTS_VIEW))throw new ForbiddenException('Conciliação exige consulta dos documentos da unidade.');
 }
 async invoiceCandidates(t:TenantContext,id:string){
  this.reconciliationEnabled();await this.invoiceAccess(t);return this.rpc('ccee_reconciliation_action',{p_org:t.organizationId,p_actor:t.userId,p_action:'candidates',p_id:cceeUuid(id),p_body:{}});
 }
 async reconcileInvoice(t:TenantContext,id:string,input:unknown){
  this.reconciliationEnabled();await this.invoiceAccess(t,true);
  const b=cceeObject(input,['documentId','requestId','reason'],['verifiedBasis']);cceeUuid(b.documentId);cceeUuid(b.requestId);cceeText(b.reason);cceeUuid(id);
  const args={p_org:t.organizationId,p_actor:t.userId,p_id:id},source=await this.rpc('ccee_reconciliation_action',{...args,p_action:'source',p_body:{documentId:b.documentId}});
  let invoice=invoiceConsumption(source.document,source.ocr);
  if(b.verifiedBasis!==undefined)try{invoice=verifiedInvoiceBasis(invoice,b.verifiedBasis,t.userId);}catch{throw new BadRequestException('Informe intervalo, perdas e referência efetivamente conferidos na fatura; nenhuma base foi presumida.');}
  const payload=reconcileConsumption(source.job,source.binding,invoice);
  return this.rpc('ccee_reconciliation_action',{...args,p_action:'save',p_body:{documentId:b.documentId,requestId:b.requestId,reason:b.reason,sourceFingerprint:source.sourceFingerprint,payload}});
 }
 async reconciliations(t:TenantContext,unitId:string,month:string,page=0){
  await this.invoiceAccess(t);cceeText(unitId,100,1);cceeMonth(month,false);if(!Number.isInteger(page)||page<0||page>1000)throw new BadRequestException('Página inválida.');
  if(process.env.CCEE_RECONCILIATION_ENABLED!=='true'||process.env.CCEE_DATA_WORKSPACE_ENABLED!=='true')return {organizationId:t.organizationId,enabled:false,rows:[],page};
  const result=await this.rpc('ccee_reconciliation_action',{p_org:t.organizationId,p_actor:t.userId,p_action:'list',p_id:null,p_body:{unitId,month,page}});
  return {...result,enabled:true,rows:result.rows.map((r:any)=>({...r,summary:reconciliationSummary(r.payload)}))};
 }
 async exportMeasurements(t:TenantContext,id:string){
  this.reconciliationEnabled();await this.allowed(t);const source=await this.job(t,id);
  try{return measurementCsv(source.job,source.binding);}catch{throw new BadRequestException('Exportação exige medições completas, com qualidade e fonte conferidas.');}
 }
 async metrics(actor:string,month:unknown){
  cceeMonth(month,false);return this.rpc('ccee_data_metrics',{p_actor:actor,p_month:String(month)+'-01'});
 }
}
