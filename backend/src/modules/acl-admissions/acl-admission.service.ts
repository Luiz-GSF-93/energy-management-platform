import { BadRequestException, ConflictException, ForbiddenException, Injectable, InternalServerErrorException, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SupabaseService } from '../../services/supabase.service';
import { LicensesService } from '../licenses/services/licenses.service';
import { TenantContext } from '../../common/interfaces/tenant-context.interface';
import { validateWriteDto } from '../../common/validation/validate-write-dto';
import { AclHeartbeatDto, AclWorkCommandDto, CreateAclAdmissionDto } from './acl-admission.dto';
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
    if (e.code === '42501') throw new ForbiddenException('Adesão exige vínculo, permissão e licença vigentes.');
    if (e.code === 'P4102') throw new NotFoundException('Cliente, unidade ou adesão indisponíveis neste escopo.');
    if (['23505', '40001'].includes(e.code)) throw new ConflictException('A unidade já possui adesão ou a requisição mudou. Atualize a lista.');
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
    return { enabled: true, canWork: actor.canWork, canApprove: actor.canApprove };
  }
  private async allowed(t: TenantContext, write = false) { if (!(await this.access(t, write)).enabled) throw new ForbiddenException('Adesão ACL ainda não habilitada nesta organização.'); }
  private page(value: unknown, key: string) {
    if (!Array.isArray(value) || value.length > 51 || value.some(v => !v || typeof v[key] !== 'string')) throw new InternalServerErrorException('Lista de adesões inválida.');
    const rows = value.slice(0, 50); return { rows, nextCursor: value.length === 51 ? rows[49][key] as string : null };
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
