import {aclHistoryDraft,validAclHistory,aclInvoiceReferenceMonth} from './acl-invoice-history';
import {fixedHistoryTariffs,simulateFixedHistory} from './acl-history-simulation';
import {supplierProposal,supplierPreview} from './acl-supplier-preview';
import {invoiceSubmarket} from './acl-invoice-submarket';
import {extractCpflPaulistaLayout} from '../ocr/cpfl-paulista-layout';
import { BadRequestException, ConflictException, ForbiddenException, Injectable, InternalServerErrorException, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SupabaseService } from '../../services/supabase.service';
import { LicensesService } from '../licenses/services/licenses.service';
import { TenantContext } from '../../common/interfaces/tenant-context.interface';
import { validateWriteDto } from '../../common/validation/validate-write-dto';
import { AclStudySaveDto, AclStudyReviewDto, AclReopenDto, AclClosureCommandDto, AclEvidenceCommandDto, AclHeartbeatDto, AclWorkCommandDto, CreateAclAdmissionDto, AclRequestDto } from './acl-admission.dto';
export const ACL_VIEW = '2c933fdf-0bbf-406a-915c-03e7921e54d8';
export const ACL_MANAGE = '820dc44f-15a0-4c2a-871e-2c1d2d443d9e';
export const ACL_APPROVE = '26cadaa7-2eea-4080-91f6-1f26f87ca809';
const CUSTOMER_VIEW = 'cbb2e904-0718-4eec-9396-dba899118cdd';
const REPORT_VIEW = '3ebadd32-6f30-459e-8ed3-0d2843d89946';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export function aclCursor(q: unknown, candidate = false): string | null {
  if (!q || typeof q !== 'object' || Array.isArray(q) || Object.keys(q).some(k => k !== 'after')) throw new BadRequestException('Filtro de adesões inválido.');
  const value = (q as Record<string, unknown>).after;
  if (value === undefined) return null;
  if (typeof value !== 'string' || (candidate ? !/^[A-Za-z0-9_-]{1,100}$/.test(value) : !UUID.test(value))) throw new BadRequestException('Cursor de adesões inválido.');
  return value;
}
@Injectable()
export class AclAdmissionService {
  constructor(private db: SupabaseService, private licenses: LicensesService, private config: ConfigService) {}
  private enabled(org: string) { return (this.config.get<string>('ACL_ADMISSION_ORGANIZATIONS') || '').split(',').map(v => v.trim()).includes(org); }
  private scope(t: TenantContext) {
    if (!t?.organizationId || !t.userId || !t.roleId || (t.scope as string) === 'global') throw new ForbiddenException('Selecione uma organização autorizada.');
  }
  private fail(e: any) {
    if (!e) return;
    if(e.code==='P4103')throw new BadRequestException('Conclua ou cancele as solicitações e os prazos vinculados antes de encerrar a adesão.');
    if (['42501','P2031'].includes(e.code)) throw new ForbiddenException('Adesão exige vínculo, permissão e licença vigentes.');
    if (['P4102','P2033'].includes(e.code)) throw new NotFoundException('Cliente, unidade ou adesão indisponíveis neste escopo.');
    if (['23505', '40001','P2032'].includes(e.code)) throw new ConflictException('A unidade já possui adesão ou a requisição mudou. Atualize a lista.');
    if (['22023', '23514', '22P02'].includes(e.code)) throw new BadRequestException('Confira o cadastro, ACR e elegibilidade da unidade.');
    throw new InternalServerErrorException('Não foi possível consultar a adesão ACL.');
  }
  private params(t: TenantContext) { return { p_org: t.organizationId, p_actor: t.userId, p_role: t.roleId, p_platform: t.accessMode === 'platform_operation' }; }
  private async rpc(name: string, params: Record<string, unknown>) {
    const result = await this.db.getClient().rpc(name, params); this.fail(result.error); return result.data;
  }
  async access(t: TenantContext, write = false) {
    this.scope(t);
    if (t.accessMode !== 'platform_operation' && (!['admin_org', 'gestor', 'operacional'].includes(t.role) ||
        !t.permissions?.includes(ACL_VIEW) || !t.permissions.includes(CUSTOMER_VIEW) || write && !t.permissions.includes(ACL_MANAGE))) {
      throw new ForbiddenException('Adesão disponível ao backoffice autorizado.');
    }
    await this.licenses.requireEntitlement(t.organizationId, 'free_market_management');
    if (!this.enabled(t.organizationId)) return { enabled: false, canWork: false, canApprove: false };
    const actor = await this.rpc('acl_assert_actor', { ...this.params(t), p_write: write, p_customer: null });
    if (actor?.organizationId !== t.organizationId || actor?.actorId !== t.userId || typeof actor.canWork !== 'boolean' || typeof actor.canApprove !== 'boolean') throw new InternalServerErrorException('Escopo da adesão indisponível.');
    const requestEnabled=(this.config.get<string>('ACL_ADMISSION_REQUEST_ORGANIZATIONS')||'').split(',').map(v=>v.trim()).includes(t.organizationId);
    const canReadRequests=requestEnabled&&(t.accessMode==='platform_operation'||['8f105b02-4443-49de-b188-847e0284e7ed','1479c0b7-9608-4e95-bd83-7e6899255a78','cb949e2a-e01d-4cf0-8c69-6ca74fe4d627'].every(p=>t.permissions?.includes(p)));
    const canRequest=canReadRequests&&actor.canWork&&(t.accessMode==='platform_operation'||['d1f1b3be-a842-41e7-aeb1-45fefeb2f4c1','6da45eb4-810c-4e40-9933-d9cda66a8841'].every(p=>t.permissions?.includes(p)));
    return { enabled: true, canWork: actor.canWork, canApprove: actor.canApprove && (t.accessMode === 'platform_operation' || ['admin_org','gestor'].includes(t.role)),canReadRequests,canRequest };
  }
  private async allowed(t: TenantContext, write = false) { if (!(await this.access(t, write)).enabled) throw new ForbiddenException('Adesão ACL ainda não habilitada nesta organização.'); }
  private page(value: unknown, key: string) {
    if (!Array.isArray(value) || value.length > 51 || value.some(v => !v || typeof v[key] !== 'string')) throw new InternalServerErrorException('Lista de adesões inválida.');
    const rows = value.slice(0, 50); return { rows, nextCursor: value.length === 51 ? rows[49][key] as string : null };
  }
  private async requestAllowed(id: string,t: TenantContext,write=false) {
    if(!UUID.test(id))throw new BadRequestException('Adesão inválida.');
    await this.allowed(t,write);
    if(!(this.config.get<string>('ACL_ADMISSION_REQUEST_ORGANIZATIONS')||'').split(',').map(v=>v.trim()).includes(t.organizationId))throw new ForbiddenException('Solicitações ACL ainda não habilitadas nesta organização.');
    const required=['8f105b02-4443-49de-b188-847e0284e7ed','1479c0b7-9608-4e95-bd83-7e6899255a78','cb949e2a-e01d-4cf0-8c69-6ca74fe4d627',...(write?['d1f1b3be-a842-41e7-aeb1-45fefeb2f4c1','6da45eb4-810c-4e40-9933-d9cda66a8841']:[])];
    if(t.accessMode!=='platform_operation'&&!required.every(p=>t.permissions?.includes(p)))throw new ForbiddenException('Solicitações ACL exigem Documentos, Solicitações e Agenda.');
    await this.licenses.requireEntitlement(t.organizationId,'document_management');
  }
  async requests(id:string,q:unknown,t:TenantContext) {
    const after=aclCursor(q);await this.requestAllowed(id,t);
    return this.page(await this.rpc('acl_request_read',{...this.params(t),p_id:id,p_after:after}),'id');
  }
  async createRequest(id:string,input:unknown,t:TenantContext) {
    const d=await validateWriteDto(AclRequestDto,input as AclRequestDto);await this.requestAllowed(id,t,true);
    const {requestId,expectedRevision,...data}=d;
    const result=await this.rpc('acl_request_create',{...this.params(t),p_id:id,p_request:requestId,p_revision:expectedRevision,p_data:data});
    if(!result||!['id','requestRecordId','agendaRecordId','messageId'].every(k=>UUID.test(result[k])))throw new InternalServerErrorException('Confirmação da solicitação indisponível.');
    return result;
  }
  async candidates(q: unknown, t: TenantContext) {
    const after = aclCursor(q, true); await this.allowed(t);
    return this.page(await this.rpc('acl_candidates', { ...this.params(t), p_after: after || '' }), 'unitId');
  }
  async list(q: unknown, t: TenantContext) {
    const after = aclCursor(q); await this.allowed(t);
    return this.page(await this.rpc('acl_read', { ...this.params(t), p_id: null, p_after: after }), 'id');
  }
  async one(id: string, t: TenantContext) {
    if (!UUID.test(id)) throw new BadRequestException('Identificador de adesão inválido.');
    await this.allowed(t);
    const value = await this.rpc('acl_read', { ...this.params(t), p_id: id, p_after: null });
    if (!Array.isArray(value) || value.length !== 1 || value[0].organizationId !== t.organizationId || value[0].id !== id) throw new InternalServerErrorException('Escopo da adesão inválido.');
    return value[0];
  }
  async create(input: unknown, t: TenantContext) {
    const dto = await validateWriteDto(CreateAclAdmissionDto, input as CreateAclAdmissionDto); await this.allowed(t, true);
    const row = await this.rpc('acl_create', { ...this.params(t), p_request: dto.requestId, p_customer: dto.customerId, p_unit: dto.unitId });
    if (row?.organizationId !== t.organizationId || row?.customerId !== dto.customerId || row?.unitId !== dto.unitId) throw new InternalServerErrorException('Escopo da adesão inválido.');
    return row;
  }
  async work(id: string, input: unknown, t: TenantContext) {
    if (!UUID.test(id)) throw new BadRequestException('Identificador de adesão inválido.');
    const dto = await validateWriteDto(AclWorkCommandDto, input as AclWorkCommandDto);
    if (dto.action !== 'PAUSE' && (dto.pauseReason != null || dto.reason != null) ||
        dto.action === 'PAUSE' && (!dto.pauseReason || dto.pauseReason === 'OTHER' && (!dto.reason || dto.reason.trim().length < 10))) {
      throw new BadRequestException('Confira o motivo da pausa; Outros exige uma justificativa.');
    }
    await this.allowed(t, true);
    const result = await this.rpc('acl_work_command', { ...this.params(t), p_id: id, p_request: dto.requestId,
      p_revision: dto.expectedRevision, p_stage: dto.stageKey, p_action: dto.action, p_pause: dto.pauseReason ?? null, p_reason: dto.reason ?? null });
    if (result?.ok === false && ['CONFLICT','LOCKED'].includes(result.code)) {
      // The database already committed stale-lease reconciliation. Do not retry
      // a changed revision or silently overwrite another operator's activity.
      throw new ConflictException('A atividade mudou ou foi interrompida. Atualize o processo antes de continuar.');
    }
    if (result?.ok !== true || result.admission?.id !== id || result.admission?.organizationId !== t.organizationId) {
      throw new InternalServerErrorException('Estado da atividade indisponível.');
    }
    return result.admission;
  }
  async heartbeat(id: string, input: unknown, t: TenantContext) {
    if (!UUID.test(id)) throw new BadRequestException('Identificador de adesão inválido.');
    const dto = await validateWriteDto(AclHeartbeatDto, input as AclHeartbeatDto); await this.allowed(t, true);
    const result = await this.rpc('acl_work_heartbeat', { ...this.params(t), p_id: id, p_stage: dto.stageKey });
    if (result?.ok === false && result.code === 'LOCKED') throw new ConflictException('Sessão interrompida. Atualize e retome a atividade.');
    if (result?.ok !== true || typeof result.confirmedAt !== 'string' || !Number.isInteger(result.revision)) throw new InternalServerErrorException('Confirmação da atividade indisponível.');
    return { confirmedAt: result.confirmedAt, revision: result.revision };
  }
  private async evidenceAllowed(id: string, t: TenantContext, write = false, approve = false) {
    if (!UUID.test(id)) throw new BadRequestException('Identificador de adesão inválido.');
    const access = await this.access(t, write);
    if (!access.enabled) throw new ForbiddenException('Adesão ACL ainda não habilitada nesta organização.');
    if (t.accessMode !== 'platform_operation' && (!t.permissions?.includes('8f105b02-4443-49de-b188-847e0284e7ed') || approve && !access.canApprove)) {
      throw new ForbiddenException('Evidências exigem documentos e aprovação do perfil autorizado.');
    }
    await this.licenses.requireEntitlement(t.organizationId,'document_management');
  }
  async evidenceList(id: string, q: unknown, t: TenantContext, sources = false) {
    const after = aclCursor(q,sources); await this.evidenceAllowed(id,t);
    return this.page(await this.rpc(sources?'acl_evidence_sources':'acl_evidence_read',{
      ...this.params(t),p_id:id,p_after: sources ? after || '' : after }), 'id');
  }
  async historySimulation(id:string,input:unknown,t:TenantContext){
    const b=input as {evidenceId:string;tariffs:unknown};
    if(!b||typeof b!=='object'||Array.isArray(b)||Object.keys(b).sort().join(',')!=='evidenceId,tariffs'||!UUID.test(b.evidenceId))throw new BadRequestException('Selecione o histórico aprovado e as tarifas.');
    let tariffs;try{tariffs=fixedHistoryTariffs(b.tariffs);}catch(e){throw new BadRequestException((e as Error).message);}
    await this.evidenceAllowed(id,t);const admission=await this.one(id,t);
    const unit=await this.db.getClient().from('consumer_units').select('tariff_group,tariff_subgroup,tariff_modality').eq('organization_id',t.organizationId).eq('customer_id',admission.customerId).eq('id',admission.unitId).maybeSingle();
    if(unit.error)throw new InternalServerErrorException('Enquadramento indisponível.');
    if(unit.data?.tariff_group!=='A'||unit.data?.tariff_subgroup!=='A4'||unit.data?.tariff_modality!=='GREEN')throw new BadRequestException('Esta simulação exige enquadramento Verde A4 conferido.');
    const source=await this.rpc('acl_history_simulation_source',{...this.params(t),p_id:id,p_evidence:b.evidenceId});
    if(source?.evidenceId!==b.evidenceId||!source.history)throw new InternalServerErrorException('Fonte da simulação indisponível.');
    try{return {evidenceId:source.evidenceId,documents:source.documents,...simulateFixedHistory(source.history,tariffs)};}catch{throw new ConflictException('Histórico aprovado indisponível; confira a fonte atual.');}
  }
  async supplierPreview(id:string,input:unknown,t:TenantContext){
    const b=input as {evidenceId:string;proposal:unknown};
    if(!b||typeof b!=='object'||Array.isArray(b)||Object.keys(b).sort().join(',')!=='evidenceId,proposal'||!UUID.test(b.evidenceId))throw new BadRequestException('Selecione o histórico aprovado e a proposta.');
    let proposal;try{proposal=supplierProposal(b.proposal);}catch(e){throw new BadRequestException((e as Error).message);}
    await this.evidenceAllowed(id,t);
    const source=await this.rpc('acl_history_simulation_source',{...this.params(t),p_id:id,p_evidence:b.evidenceId});
    if(source?.evidenceId!==b.evidenceId||!source.history)throw new InternalServerErrorException('Fonte da simulação indisponível.');
    const location=await this.invoiceLocation(id,source.history.sourceDocumentId,source.documents,t);
    try{return {evidenceId:source.evidenceId,documents:source.documents,location,...supplierPreview(source.history,proposal)};}catch{throw new ConflictException('Histórico ou valores fora dos limites da simulação; confira a fonte atual.');}
  }
  async studies(id:string,q:unknown,t:TenantContext){
    const after=aclCursor(q);await this.evidenceAllowed(id,t);
    return this.page(await this.rpc('acl_economic_study_read',{...this.params(t),p_id:id,p_after:after}),'id');
  }
  async saveStudy(id:string,input:unknown,t:TenantContext){
    const d=await validateWriteDto(AclStudySaveDto,input as AclStudySaveDto);
    await this.evidenceAllowed(id,t,true);
    // The browser sends premises only. All results and source proofs are generated here.
    const result=await this.supplierPreview(id,{evidenceId:d.evidenceId,proposal:d.proposal},t);
    const source=await this.rpc('acl_history_simulation_source',{...this.params(t),p_id:id,p_evidence:d.evidenceId});
    const snapshot={schemaVersion:'acl-economic-study/1',source,result:{...result,warnings:result.warnings.map(w=>w.startsWith('Prévia interna sem persistência')?'Versão interna imutável de um estudo parcial. A revisão confirma apenas premissas; não publica no portal, contrata, altera apurações ou confirma o início do suprimento.':w)}};
    return this.studyResult(await this.rpc('acl_economic_study_command',{...this.params(t),p_id:id,p_request:d.requestId,p_revision:d.expectedRevision,p_action:'SAVE',p_checked:d.checkedDocument,p_snapshot:snapshot}),id,t);
  }
  async reviewStudy(id:string,input:unknown,t:TenantContext){
    const d=await validateWriteDto(AclStudyReviewDto,input as AclStudyReviewDto);
    if(d.reason.trim().length<20)throw new BadRequestException('Justifique a revisão das premissas.');
    await this.evidenceAllowed(id,t,true,true);
    return this.studyResult(await this.rpc('acl_economic_study_command',{...this.params(t),p_id:id,p_request:d.requestId,p_revision:d.expectedRevision,p_action:d.action,p_checked:d.checkedDocument,p_study:d.studyId,p_reason:d.reason,p_hash:d.hash}),id,t);
  }
  private studyResult(result:any,id:string,t:TenantContext){
    if(result?.ok===false&&['CONFLICT','LOCKED'].includes(result.code))throw new ConflictException('O cenário ou a atividade mudou. Atualize o processo e confira a viabilidade em andamento.');
    if(result?.ok!==true||result.admission?.id!==id||result.admission?.organizationId!==t.organizationId||!UUID.test(result.studyId))throw new InternalServerErrorException('Versão do estudo indisponível.');
    return {admission:result.admission,studyId:result.studyId};
  }
  private async invoiceLocation(id:string,document:string,sources:any[],t:TenantContext){
    const source=Array.isArray(sources)?sources.find(v=>v.id===document):null;
    if(!source||typeof source.fileHash!=='string')throw new InternalServerErrorException('Versão documental indisponível.');
    const admission=await this.one(id,t),db=this.db.getClient();
    const d=await db.from('documents').select('id,file_hash,file_verified,document_type').eq('organization_id',t.organizationId).eq('id',document).eq('customer_id',admission.customerId).eq('consumer_unit_id',admission.unitId).maybeSingle();
    if(d.error)throw new InternalServerErrorException('Endereço da fatura indisponível.');
    if(!d.data||!d.data.file_verified||d.data.document_type!=='INVOICE_DISTRIBUTOR'||d.data.file_hash!==source.fileHash)throw new ConflictException('A versão da fatura mudou; confira a fonte aprovada.');
    const job=await db.from('document_ocr_jobs').select('id,state').eq('organization_id',t.organizationId).eq('document_id',document).maybeSingle();
    if(job.error)throw new InternalServerErrorException('Leitura da fatura indisponível.');
    if(job.data?.state!=='SUCCEEDED')return {documentId:document,fileHash:source.fileHash,...invoiceSubmarket(null)};
    const r=await db.from('document_ocr_results').select('raw_result,file_hash').eq('organization_id',t.organizationId).eq('document_id',document).eq('job_id',job.data.id).maybeSingle();
    if(r.error)throw new InternalServerErrorException('Endereço da leitura indisponível.');
    if(!r.data||r.data.file_hash!==source.fileHash)throw new ConflictException('A leitura pertence a outra versão da fatura.');
    const fields=extractCpflPaulistaLayout(r.data.raw_result).fields.filter(f=>f.name==='serviceAddress');
    return {documentId:document,fileHash:source.fileHash,addressSource:fields.length===1?fields[0].source:null,...invoiceSubmarket(fields.length===1?fields[0].value.text:null)};
  }
  async historyPreview(id:string,document:string,t:TenantContext){
    if(!/^[A-Za-z0-9_-]{1,100}$/.test(document))throw new BadRequestException('Documento inválido.');
    await this.evidenceAllowed(id,t);const admission=await this.one(id,t),db=this.db.getClient();
    const d=await db.from('documents').select('id,organization_id,customer_id,consumer_unit_id,reference_month,file_hash,file_verified,document_type').eq('organization_id',t.organizationId).eq('id',document).eq('customer_id',admission.customerId).eq('consumer_unit_id',admission.unitId).maybeSingle();
    if(d.error)throw new InternalServerErrorException('Fonte documental indisponível.');
    const referenceMonth=aclInvoiceReferenceMonth(d.data?.reference_month);
    if(!d.data||!d.data.file_verified||d.data.document_type!=='INVOICE_DISTRIBUTOR'||!referenceMonth)throw new NotFoundException('Fatura desta unidade indisponível.');
    const job=await db.from('document_ocr_jobs').select('id,state').eq('organization_id',t.organizationId).eq('document_id',document).maybeSingle();
    if(job.error||job.data?.state!=='SUCCEEDED')throw new ConflictException('Processe a fatura em Documentos antes de interpretar o histórico.');
    const result=await db.from('document_ocr_results').select('raw_result,file_hash').eq('organization_id',t.organizationId).eq('document_id',document).eq('job_id',job.data.id).maybeSingle();
    if(result.error||!result.data||result.data.file_hash!==d.data.file_hash)throw new ConflictException('A fonte da leitura mudou; processe a versão atual.');
    const layout=extractCpflPaulistaLayout(result.data.raw_result);
    if(layout.layoutId!=='cpfl-paulista-a'||!layout.measurements)throw new ConflictException('Histórico deste layout ainda requer leitura e revisão no módulo Documentos.');
    return {documentId:document,fileHash:d.data.file_hash,classification:layout.fields.find(f=>f.name==='classification')?.value.text??null,...aclHistoryDraft(layout.measurements.history,referenceMonth)};
  }
  async checklists(id:string,t:TenantContext){await this.evidenceAllowed(id,t);return this.rpc('acl_checklist_catalog',{...this.params(t),p_id:id});}
  async evidenceCommand(id: string, input: unknown, t: TenantContext) {
    const dto = await validateWriteDto(AclEvidenceCommandDto,input as AclEvidenceCommandDto);
    const fields: Record<string,string[]> = {SUBMIT:['stageKey','kind','documentIds','note','facts'],APPROVE:['evidenceId','note'],REJECT:['evidenceId','note'],COMPLETE:['evidenceId'],SKIP:['evidenceId']};
    const optional=['stageKey','kind','documentIds','note','facts','evidenceId'] as const;
    if (optional.some(k=>fields[dto.action].includes(k)?dto[k]==null:dto[k]!==undefined) || dto.note && dto.note.trim().length<20 ||
        ['APPROVE','REJECT'].includes(dto.action) && dto.note!.length>1000 || dto.facts && JSON.stringify(dto.facts).length>12000) {
      throw new BadRequestException('Confira os campos e a justificativa da evidência.');
    }
    if (dto.action==='SUBMIT') {
      const f={...dto.facts!};delete f.checklist;const keys=Object.keys(f);
      const expected=dto.kind==='SKIP'?null:dto.stageKey==='modality'?'modality':dto.stageKey==='supply'?'supplyDate':dto.stageKey==='invoices'&&keys.length?'history':null;
      if (expected ? keys.length!==1 || keys[0]!==expected : keys.length!==0) throw new BadRequestException('Informações adicionais da evidência inválidas.');
      if(expected==='history'&&!validAclHistory(f.history,dto.documentIds!))throw new BadRequestException('Confira os 12 meses consecutivos, consumo, demanda, dias e fontes do histórico.');
      if (expected==='modality' && !['RETAIL','OWN_AGENT'].includes(f.modality as string)) throw new BadRequestException('Informe a modalidade conferida pelo Consultor.');
      if (expected==='supplyDate') {
        const value=f.supplyDate,date=typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)?new Date(value+'T00:00:00Z'):null;
        if (!date || !Number.isFinite(date.getTime()) || date.toISOString().slice(0,10)!==value) throw new BadRequestException('Informe uma data confirmada válida.');
      }
    }
    await this.evidenceAllowed(id,t,true,['APPROVE','REJECT','SKIP'].includes(dto.action));
    const result = await this.rpc('acl_evidence_command',{...this.params(t),p_id:id,p_request:dto.requestId,p_revision:dto.expectedRevision,
      p_action:dto.action,p_stage:dto.stageKey??null,p_kind:dto.kind??null,p_documents:dto.documentIds??null,p_note:dto.note??null,p_facts:dto.facts??null,p_evidence:dto.evidenceId??null,p_checked:dto.checkedDocument});
    if (result?.ok===false && ['CONFLICT','LOCKED','DEPENDENCIES'].includes(result.code)) throw new ConflictException(result.code==='DEPENDENCIES'?'Conclua as pré-condições da etapa antes de continuar.':'A evidência ou atividade mudou. Atualize o processo.');
    if (result?.ok!==true || result.admission?.id!==id || result.admission?.organizationId!==t.organizationId || !UUID.test(result.evidenceId)) throw new InternalServerErrorException('Registro da evidência indisponível.');
    return {admission:result.admission,evidenceId:result.evidenceId};
  }
  async reopen(id: string, input: unknown, t: TenantContext) {
    const dto=await validateWriteDto(AclReopenDto,input as AclReopenDto);
    if(dto.reason.trim().length<20) throw new BadRequestException('Justifique a reabertura.');
    await this.evidenceAllowed(id,t,true,true);
    const result=await this.rpc('acl_reopen',{...this.params(t),p_id:id,p_request:dto.requestId,p_revision:dto.expectedRevision,p_reason:dto.reason,p_checked:dto.checkedDocument});
    if(result?.ok===false && ['CONFLICT','LOCKED'].includes(result.code)) throw new ConflictException('A adesão mudou ou já possui reabertura. Atualize o processo.');
    if(result?.ok!==true || result.admission?.organizationId!==t.organizationId || result.admission?.previousId!==id || !UUID.test(result.admission?.id)) throw new InternalServerErrorException('Reabertura indisponível.');
    return result.admission;
  }
  async performance(q: unknown, t: TenantContext) {
    if(!q || typeof q!=='object' || Array.isArray(q) || Object.keys(q).some(k=>!['after','unitId'].includes(k))) throw new BadRequestException('Filtro de desempenho inválido.');
    const filters=q as {after?:unknown;unitId?:unknown};const after=aclCursor(filters.after===undefined?{}:{after:filters.after});
    if(filters.unitId!==undefined && (typeof filters.unitId!=='string' || !/^[A-Za-z0-9_-]{1,100}$/.test(filters.unitId))) throw new BadRequestException('Unidade inválida.');
    await this.allowed(t);
    if(t.accessMode!=='platform_operation' && !t.permissions?.includes('8f105b02-4443-49de-b188-847e0284e7ed')) throw new ForbiddenException('Desempenho exige acesso a documentos.');
    await this.licenses.requireEntitlement(t.organizationId,'document_management');
    return this.page(await this.rpc('acl_performance_read',{...this.params(t),p_after:after,p_unit:filters.unitId??null}),'id');
  }
  async closureRead(id: string, t: TenantContext) {
    await this.evidenceAllowed(id,t);
    const value=await this.rpc('acl_closure_read',{...this.params(t),p_id:id});
    if (value?.performance && (value.performance.body?.organizationId!==t.organizationId || value.performance.body?.admissionId!==id)) throw new InternalServerErrorException('Escopo do fechamento inválido.');
    return value;
  }
  async closureCommand(id: string, input: unknown, t: TenantContext) {
    const dto=await validateWriteDto(AclClosureCommandDto,input as AclClosureCommandDto);
    if (dto.action==='CLOSE' ? dto.conclusion!==undefined || dto.performanceHash!==undefined : !dto.performanceHash || !dto.conclusion || dto.conclusion.trim().length<10) throw new BadRequestException('Confira a operação de encerramento ou publicação.');
    await this.evidenceAllowed(id,t,true,true);
    const result=await this.rpc('acl_closure_command',{...this.params(t),p_id:id,p_request:dto.requestId,p_revision:dto.expectedRevision,p_action:dto.action,p_checked:dto.checkedDocument,p_conclusion:dto.conclusion??null,p_hash:dto.performanceHash??null});
    if(result?.ok===false && ['CONFLICT','LOCKED','DEPENDENCIES'].includes(result.code)) throw new ConflictException(result.code==='DEPENDENCIES'?'Conclua todas as etapas e encerre as atividades antes de fechar.':'O fechamento mudou. Atualize o processo.');
    if(result?.ok!==true || result.admission?.id!==id || result.admission?.organizationId!==t.organizationId || result.closure?.performance?.body?.organizationId!==t.organizationId || result.closure?.performance?.body?.admissionId!==id) throw new InternalServerErrorException('Confirmação do encerramento indisponível.');
    return {admission:result.admission,closure:result.closure};
  }
  async portal(q: unknown, t: TenantContext) {
    const after = aclCursor(q); this.scope(t);
    if (t.accessMode || t.role !== 'consulta' || !t.permissions?.includes(REPORT_VIEW)) throw new ForbiddenException('Portal exige consulta externa e vínculo com cliente.');
    await this.licenses.requireEntitlement(t.organizationId, 'free_market_management');
    if (!this.enabled(t.organizationId)) return { enabled: false, rows: [], nextCursor: null };
    const page = this.page(await this.rpc('acl_portal', { p_org: t.organizationId, p_actor: t.userId, p_role: t.roleId, p_after: after }), 'cursor');
    const rows = page.rows.map(row => {
      if (typeof row.unitId !== 'string' || typeof row.unitName !== 'string' || !['NOT_STARTED', 'IN_PROGRESS', 'CONCLUDED'].includes(row.status)) throw new InternalServerErrorException('Status de adesão inválido.');
      const visible: Record<string, unknown> = { unitId: row.unitId, unitName: row.unitName, status: row.status };
      if (row.status === 'CONCLUDED' && row.summary) {
        const s = row.summary;
        if (!['RETAIL', 'OWN_AGENT'].includes(s.modality) || typeof s.supplyDate !== 'string' || typeof s.conclusion !== 'string' || typeof s.publishedAt !== 'string') throw new InternalServerErrorException('Resumo da adesão inválido.');
        visible.summary = { modality: s.modality, supplyDate: s.supplyDate, conclusion: s.conclusion, publishedAt: s.publishedAt };
      }
      return visible;
    });
    return { enabled: true, rows, nextCursor: page.nextCursor };
  }
}
