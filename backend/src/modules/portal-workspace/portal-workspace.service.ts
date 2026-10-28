import {BadRequestException,ConflictException,ForbiddenException,Injectable,NotFoundException,Optional,ServiceUnavailableException,StreamableFile} from '@nestjs/common';
import {createHash} from 'node:crypto';
import {LicensesService} from '../licenses/services/licenses.service';
import {SupabaseService} from '../../services/supabase.service';
import {TenantContext} from '../../common/interfaces/tenant-context.interface';
import {DocumentsService} from '../documents/services/documents.service';
import {DocumentFile,DOCUMENT_BUCKET,MAX_DOCUMENT_BYTES,inspectDocumentUpload} from '../documents/services/document-file';
import {OcrQueueService} from '../ocr/ocr-queue.service';
import {assertPortalInvoiceUpload} from './portal-invoice-kind';
import {AutomaticIntakeService} from './automatic-intake.service';

const uuid=(s:unknown)=>typeof s==='string'&&/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(s);
const documentTypes:Record<string,string>={INVOICE:'INVOICE_DISTRIBUTOR',FISCAL:'TAX_DOCUMENT',CONTRACT:'CONTRACT_ENERGY',BILLING:'OTHER',ART:'COMPLIANCE_REPORT',TECHNICAL:'COMPLIANCE_REPORT',REPORT:'COMPLIANCE_REPORT',OTHER:'OTHER'};
export function portalIntakeStatus(row:any){
 if(row.published===true)return {code:'PUBLISHED',label:'Publicado'};
 if(row.intakeState==='REJECTED')return {code:'REJECTED',label:'Complemento solicitado'};
 if(['FAILED','SUBMISSION_UNKNOWN'].includes(row.ocrState)||['ERROR','AUTOMATION_STOPPED'].includes(row.intakeState))return {code:'ERROR',label:'Requer conferência da equipe'};
 if(row.prepared===true||row.intakeState==='VALIDATING')return {code:'VALIDATING',label:'Em validação'};
 if(['SUBMITTING','POLLING','SUCCEEDED'].includes(row.ocrState))return {code:'ANALYSING',label:'Em análise'};
 if(row.origin==='BACKOFFICE'&&row.documentId)return {code:'AVAILABLE',label:'Disponível no backoffice'};
 return row.documentId?{code:'RECEIVED',label:'Enviado'}:{code:'RESERVED',label:'Recebimento não confirmado'};
}
export function portalIntakeNotice(r:any){
 if(r.ocrErrorCode==='INVOICE_ALREADY_RECEIVED')return 'EVA: já existe uma fatura ou leitura para esta unidade e competência. Solicite atendimento para conferir a versão existente.';
 if(['IDENTITY_MISMATCH','IDENTITY_REVIEW_REQUIRED','IDENTITY_REGISTRATION_UNAVAILABLE'].includes(r.ocrErrorCode))return 'EVA: UC, CNPJ, endereço ou competência precisam de conferência. Solicite atendimento; o preenchimento automático foi interrompido.';
 if(r.ocrErrorCode==='SOURCE_HASH_MISMATCH')return 'O arquivo preservado requer conferência de integridade pela equipe.';
 if(r.ocrState==='QUEUED')return 'Leitura enfileirada.';
 return r.origin==='BACKOFFICE'?'Fatura disponibilizada a partir do arquivo existente no backoffice, sem nova leitura.':null;
}
@Injectable()
export class PortalWorkspaceService {
 constructor(private db:SupabaseService,private documents:DocumentsService,private ocr:OcrQueueService,private licenses:LicensesService,@Optional() private intake?:AutomaticIntakeService){}
 private enabled(){if(process.env.PORTAL_CLIENT_WORKSPACE_ENABLED!=='true')throw new ServiceUnavailableException('A ampliação do Portal ainda não foi habilitada.');}
 async action(t:TenantContext,action:string,id:string|null=null,body:unknown={}){
  this.enabled();if(!t.organizationId||!t.userId||!t.roleId||(t.scope as string)==='global'||id&&!uuid(id))throw new ForbiddenException('Contexto do Portal indisponível.');
  const r=await this.db.getClient().rpc('portal_workspace_action',{p_org:t.organizationId,p_actor:t.userId,p_role:t.roleId,p_platform:t.accessMode==='platform_operation',p_action:action,p_id:id,p_body:body});
  if(['P2091','P2092'].includes(r.error?.code))throw new ConflictException(r.error?.code==='P2092'?'EVA: esta unidade e competência já têm fatura lida. Solicite atendimento para corrigir; nenhuma nova leitura será iniciada.':'EVA: já existe uma fatura recebida para esta unidade e competência. Solicite atendimento em Notificações; não reenvie a fatura.');
  if(r.error?.code==='42501')throw new ForbiddenException('Vínculo, unidade, licença ou destinatário indisponível.');
  if(r.error?.code==='40001'||r.error?.code==='23505')throw new ConflictException('A operação mudou. Confira o histórico antes de repetir.');
  if(r.error?.code==='22023'||r.error?.code==='23514')throw new BadRequestException('Confira os dados e a configuração do setor.');
  if(r.error)throw new ServiceUnavailableException('Resultado não confirmado. Consulte o histórico antes de repetir.');
  return r.data;
 }
 async list(t:TenantContext){const result=await this.action(t,'list');if(!Array.isArray(result.rows))throw new ServiceUnavailableException();return {rows:result.rows.map((r:any)=>({id:r.id,documentId:r.documentId,unitId:r.unitId,unitName:r.unitName,month:r.month,kind:r.kind,filename:r.filename,createdAt:r.createdAt,recordId:r.recordId,status:portalIntakeStatus(r),notice:r.ocrErrorCode==='INVOICE_ALREADY_RECEIVED'?'EVA: já existe uma fatura ou leitura para esta unidade e competência. Solicite atendimento para conferir a versão existente.':['IDENTITY_MISMATCH','IDENTITY_REVIEW_REQUIRED','IDENTITY_REGISTRATION_UNAVAILABLE'].includes(r.ocrErrorCode)?'EVA: UC, CNPJ, endereço ou competência precisam de conferência. Solicite atendimento; o preenchimento automático foi interrompido.':r.ocrErrorCode==='SOURCE_HASH_MISMATCH'?'O arquivo preservado requer conferência de integridade pela equipe.':r.ocrState==='QUEUED'?'Leitura enfileirada.':r.documentId&&!r.ocrState&&r.kind==='INVOICE'?'Arquivo preservado. A leitura depende da autorização, cota e disponibilidade do processamento.':null}))};}
 async library(t:TenantContext,input:any){
  this.enabled();if(t.accessMode||t.role!=='consulta'||!t.organizationId||!t.userId||!t.roleId||!input||Object.keys(input).some(k=>k!=='year')||!/^20\d{2}$/.test(input.year??''))throw new ForbiddenException('Biblioteca do cliente indisponível.');
  await this.licenses.requireEntitlement(t.organizationId,'document_management');
  const r=await this.db.getClient().rpc('portal_invoice_library',{p_org:t.organizationId,p_actor:t.userId,p_role:t.roleId,p_year:input.year});
  if(r.error?.code==='42501')throw new ForbiddenException('Vínculo ou unidade indisponível.');
  if(r.error||!Array.isArray(r.data?.rows))throw new ServiceUnavailableException('Biblioteca ainda não atualizada. Tente novamente.');
  return {...r.data,rows:r.data.rows.map((row:any)=>({...row,status:portalIntakeStatus(row),notice:portalIntakeNotice(row)}))};
 }
 async content(t:TenantContext,id:string){
  this.enabled();if(t.accessMode||t.role!=='consulta'||!uuid(id))throw new ForbiddenException();
  await this.licenses.requireEntitlement(t.organizationId,'document_management');
  const client=this.db.getClient(),r=await client.rpc('portal_invoice_content_source',{p_org:t.organizationId,p_actor:t.userId,p_role:t.roleId,p_id:id});
  if(r.error?.code==='42501')throw new ForbiddenException('Fatura indisponível para este vínculo.');
  if(r.error||!r.data)throw new ServiceUnavailableException('Arquivo indisponível.');const d=r.data;
  if(d.bucket!==DOCUMENT_BUCKET||typeof d.path!=='string'||!d.path.startsWith(t.organizationId+'/'+d.unitId+'/')||d.path.split('/').some((v:string)=>!v||v==='.'||v==='..')||!['application/pdf','image/png','image/jpeg'].includes(d.mime)||d.size>MAX_DOCUMENT_BYTES)throw new ConflictException('Fonte privada não confirmada.');
  const file=await client.storage.from(DOCUMENT_BUCKET).download(d.path);
  if(file.error||!file.data||file.data.size>MAX_DOCUMENT_BYTES)throw new ServiceUnavailableException('Não foi possível abrir o arquivo.');
  const bytes=Buffer.from(await file.data.arrayBuffer());if(bytes.length!==Number(d.size)||createHash('sha256').update(bytes).digest('hex')!==d.hash)throw new ConflictException('Integridade do arquivo não confirmada.');
  const fresh=await client.rpc('portal_invoice_content_source',{p_org:t.organizationId,p_actor:t.userId,p_role:t.roleId,p_id:id});
  if(fresh.error||fresh.data?.hash!==d.hash||fresh.data?.path!==d.path)throw new ForbiddenException('O vínculo mudou.');
  return new StreamableFile(bytes,{type:d.mime,disposition:'inline',length:bytes.length});
 }
 async upload(t:TenantContext,input:any,file:DocumentFile){
  this.enabled();
  if(!input||Object.keys(input).some(k=>!['requestId','unitId','month','kind','recordId','consent'].includes(k))||!uuid(input.requestId)||!uuid(input.unitId)||!/^20\d{2}-(0[1-9]|1[0-2])$/.test(input.month??'')||!documentTypes[input.kind]||input.recordId&&!uuid(input.recordId)||!['true','false',true,false].includes(input.consent))throw new BadRequestException('Selecione unidade, competência, tipo e autorização.');
  // Older portal clients use /uploads. Join the same durable intake before
  // archiving, instead of creating a second OCR workflow outside its queue.
  // Conversation attachments retain their existing receipt and message audit.
  if(input.kind==='INVOICE'&&!input.recordId&&(input.consent===true||input.consent==='true')&&this.intake?.enabled(t.organizationId)){
   const scope=await this.action(t,'context');
   if(scope.organizationId!==t.organizationId||!scope.customerId||!scope.units?.some((u:any)=>u.id===input.unitId))throw new ForbiddenException('O vínculo mudou.');
   const receipt=await this.intake.upload(t,{requestId:input.requestId,customerId:scope.customerId,unitId:input.unitId,month:input.month,consent:input.consent},file);
   return {...receipt,status:'RECEIVED',processing:'PENDING_AUTOMATION'};
  }
  const detected=await inspectDocumentUpload(file,input.kind!=='INVOICE'),hash=createHash('sha256').update(file.buffer).digest('hex');
  if(input.kind==='INVOICE')await assertPortalInvoiceUpload(file,detected.mime);
  const consent=input.consent===true||input.consent==='true';
  const receipt=await this.action(t,'reserve_upload',null,{requestId:input.requestId,unitId:input.unitId,month:input.month,kind:input.kind,recordId:input.recordId??null,consent,fileHash:hash,filename:detected.name});
  if(!receipt.acquired){if(receipt.documentId)return {id:receipt.id,replayed:true,status:'RECEIVED'};throw new ConflictException('Envio em conferência. Atualize Minhas faturas antes de repetir.');}
  const scope=await this.action(t,'context');
  if(scope.organizationId!==t.organizationId||!scope.units?.some((u:any)=>u.id===input.unitId))throw new ForbiddenException('O vínculo mudou.');
  let uploaded:any;
  try {uploaded=await this.documents.upload({customerId:scope.customerId,consumerUnitId:input.unitId,referenceMonth:input.month+'-01',documentType:documentTypes[input.kind],description:'Enviado pelo cliente · Portal · '+receipt.id},file,t.organizationId,t.userId);}
  catch(e){await this.action(t,'upload_error',receipt.id).catch(()=>undefined);throw e;}
  await this.action(t,'attach_upload',receipt.id,{documentId:uploaded.id});
  if(input.recordId){const message=await this.db.getClient().rpc('append_operation_client_message',{p_org:t.organizationId,p_actor:t.userId,p_record:input.recordId,p_request:receipt.id,p_direction:'INBOUND',p_subject:'Documento enviado pelo cliente',p_body:'Anexo recebido no atendimento: '+detected.name,p_documents:[uploaded.id]});if(message.error)throw new ServiceUnavailableException('Arquivo recebido. A vinculação à conversa precisa de conferência.');}
  let processing='NOT_REQUESTED';
  if(input.kind==='INVOICE'&&consent&&process.env.PORTAL_INVOICE_AUTOMATION_ENABLED==='true')processing='PENDING_AUTOMATION';
  return {id:receipt.id,documentId:uploaded.id,status:'RECEIVED',processing};
 }
 async file(t:TenantContext,id:string){const r=await this.action(t,'file',id);if(!r.documentId)throw new NotFoundException('Arquivo indisponível.');return this.documents.download(r.documentId,t.organizationId,true);}
 async readout(t:TenantContext,id:string,q:Record<string,string>){if(Object.keys(q).some(k=>k!=='offset')||q.offset!==undefined&&!/^\d{1,8}$/.test(q.offset))throw new BadRequestException('Página inválida.');const r=await this.action(t,'file',id);const text=await this.ocr.readout(t.organizationId,r.documentId,{page:'0',section:'text',offset:q.offset??'0'});await this.action(t,'file',id);return {text:text.text,nextOffset:text.nextOffset,previousOffset:text.previousOffset,notice:'Transcrição da leitura preservada; pode conter erros de OCR. Não representa aprovação financeira.'};}
}
