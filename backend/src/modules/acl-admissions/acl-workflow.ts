import { createHash } from 'crypto';

// Domain rules only. The persistence adapter must authenticate, revalidate RBAC,
// licenses and relationships, and lock the process before invoking a command.
// No HTTP route or direct database access is enabled by this file.
export const ACL_WORKFLOW_VERSION = 'acl-admission/1';
export const ACL_LEASE_MS = 90_000;
export const ACL_STAGES = [
  ['registration', 'Cadastro'], ['invoices', 'Faturas'],
  ['feasibility', 'Viabilidade'], ['modality', 'Modalidade'],
  ['contracts', 'Contratação'], ['termination', 'Denúncia'],
  ['metering', 'Medição'], ['custody', 'Conta e adesão'],
  ['technical', 'Habilitação técnica'], ['contract-registration', 'Registro de contratos'],
  ['validation', 'Validação'], ['supply', 'Início do suprimento'],
] as const;
export type StageKey = typeof ACL_STAGES[number][0];
export type StageStatus = 'NOT_STARTED' | 'RUNNING' | 'PAUSED' | 'COMPLETED' | 'SKIPPED';
export type PauseReason = 'AWAITING_CUSTOMER' | 'ENDING_ACTIVITY' | 'OTHER';
export type Modality = 'RETAIL' | 'OWN_AGENT';
export type Stage = {
  key: StageKey; status: StageStatus; elapsedMs: number;
  active?: { actorId: string; actorName: string; startedAt: number; heartbeatAt: number };
  evidenceRef?: string; skipReason?: string;
};
export type Command = {
  requestId: string; expectedRevision: number;
  action: 'START' | 'PAUSE' | 'RESUME' | 'HEARTBEAT' | 'COMPLETE' | 'SKIP' | 'CLOSE' | 'PUBLISH';
  stageKey?: StageKey; pauseReason?: PauseReason; reason?: string; evidenceRef?: string;
  publicSummary?: { modality: Modality; supplyDate: string; conclusion: string };
};
export type Operator = {
  // These are trusted, revalidated facts supplied by the authorization adapter.
  organizationId: string; actorId: string; actorName: string;
  canWork: boolean; canApprove: boolean;
};
export type Event = {
  revision: number; requestId: string; fingerprint: string; action: string;
  actorId: string; actorName: string; at: number; stageKey?: StageKey;
  reason?: string; pauseReason?: PauseReason; elapsedMs?: number;
};
export type Performance = {
  formatVersion: string; organizationId: string; admissionId: string;
  customerId: string; unitId: string; revision: number; closedAt: number;
  activeMs: number; calendarMs: number; stages: Stage[]; events: Event[];
};
export type Admission = {
  id: string; organizationId: string; customerId: string; unitId: string;
  workflowVersion: string; status: 'DRAFT' | 'IN_PROGRESS' | 'COMPLETED';
  revision: number; createdAt: number; stages: Stage[]; events: Event[];
  performance?: { body: Performance; sha256: string };
  publishedSummary?: { modality: Modality; supplyDate: string; conclusion: string; publishedAt: number };
};
export class AclWorkflowError extends Error {
  constructor(public readonly code: 'FORBIDDEN' | 'CONFLICT' | 'INVALID' | 'LOCKED', message: string) {
    super(message); this.name = 'AclWorkflowError';
  }
}
function invalid(message: string): never { throw new AclWorkflowError('INVALID', message); }
function text(value: unknown, min: number, max: number): value is string {
  return typeof value === 'string' && value.trim().length >= min && value.length <= max;
}
function instant(now: number) { if (!Number.isSafeInteger(now) || now < 0) invalid('Instante do servidor inválido.'); }
function clone<T>(value: T): T { return JSON.parse(JSON.stringify(value)) as T; }
function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  return '{' + Object.entries(value as Record<string, unknown>).filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([k, v]) => JSON.stringify(k) + ':' + canonical(v)).join(',') + '}';
}
export function aclHash(value: unknown) { return createHash('sha256').update(canonical(value)).digest('hex'); }
function authority(row: Admission, actor: Operator, approve: boolean) {
  if (row.organizationId !== actor.organizationId || !text(actor.actorId, 1, 100) ||
      !text(actor.actorName, 1, 160) || !(approve ? actor.canApprove : actor.canWork)) {
    throw new AclWorkflowError('FORBIDDEN', 'Acesso indisponível neste processo.');
  }
}
export function createAclAdmission(ids: Pick<Admission, 'id' | 'organizationId' | 'customerId' | 'unitId'>, now: number): Admission {
  instant(now);
  if (Object.values(ids).some(v => !text(v, 1, 100))) invalid('Vínculos do processo inválidos.');
  return { ...ids, workflowVersion: ACL_WORKFLOW_VERSION, status: 'DRAFT', revision: 1,
    createdAt: now, stages: ACL_STAGES.map(([key]) => ({ key, status: 'NOT_STARTED', elapsedMs: 0 })), events: [] };
}
function stop(stage: Stage, at: number) {
  if (!stage.active || at < stage.active.startedAt) invalid('Cronômetro inconsistente.');
  stage.elapsedMs += at - stage.active.startedAt;
  delete stage.active;
}
function expire(row: Admission, now: number) {
  for (const stage of row.stages) {
    if (!stage.active || now - stage.active.heartbeatAt < ACL_LEASE_MS) continue;
    const active = stage.active;
    // An unconfirmed gap is not credited as work. Do not use the client clock.
    stop(stage, active.heartbeatAt); stage.status = 'PAUSED'; row.revision++;
    row.events.push({ revision: row.revision, requestId: `expiry:${stage.key}:${active.startedAt}`,
      fingerprint: '', action: 'INTERRUPTED', actorId: active.actorId, actorName: active.actorName,
      at: now, stageKey: stage.key, reason: 'Conexão interrompida; retome a atividade.', elapsedMs: stage.elapsedMs });
  }
}
function start(stage: Stage, actor: Operator, now: number) {
  stage.status = 'RUNNING';
  stage.active = { actorId: actor.actorId, actorName: actor.actorName, startedAt: now, heartbeatAt: now };
}
function summary(value: Command['publicSummary']) {
  const parsedDate = value && /^\d{4}-\d{2}-\d{2}$/.test(value.supplyDate)
    ? new Date(value.supplyDate + 'T00:00:00Z') : null;
  if (!value || !['RETAIL', 'OWN_AGENT'].includes(value.modality) ||
      !parsedDate || !Number.isFinite(parsedDate.getTime()) || parsedDate.toISOString().slice(0, 10) !== value.supplyDate ||
      !text(value.conclusion, 10, 1000)) invalid('Confira modalidade, data confirmada e resumo público.');
  return { modality: value.modality, supplyDate: value.supplyDate, conclusion: value.conclusion.trim() };
}

/** Server time must be obtained by the command handler, never from request DTOs.
 * The adapter must expire a stale lease in its own locked transaction before
 * processing an optimistic command, returning the updated revision to the UI.
 */
export function reconcileAclLeases(source: Admission, actor: Operator, now: number): Admission {
  authority(source, actor, false); instant(now);
  if (now < source.createdAt || source.events.some(e => e.at > now)) invalid('Instante anterior ao histórico.');
  const row = clone(source); expire(row, now); return row;
}
export function executeAclCommand(source: Admission, command: Command, actor: Operator, now: number): Admission {
  const approval = ['SKIP', 'CLOSE', 'PUBLISH'].includes(command.action);
  authority(source, actor, approval); instant(now);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(command.requestId)) invalid('requestId inválido.');
  const fingerprint = aclHash({ command, actorId: actor.actorId });
  const previous = source.events.find(e => e.requestId === command.requestId);
  if (previous) {
    if (previous.fingerprint !== fingerprint) throw new AclWorkflowError('CONFLICT', 'Requisição já utilizada.');
    return clone(source);
  }
  if (command.expectedRevision !== source.revision) throw new AclWorkflowError('CONFLICT', 'Atualize o processo antes de continuar.');
  if (now < source.createdAt || source.events.some(e => e.at > now)) invalid('Instante anterior ao histórico.');
  if (source.workflowVersion !== ACL_WORKFLOW_VERSION) invalid('Versão do fluxo não suportada.');
  const row = clone(source);
  if (row.stages.some(s => s.active && now - s.active.heartbeatAt >= ACL_LEASE_MS)) {
    throw new AclWorkflowError('LOCKED', 'Sessão interrompida. Reconcilie e retome a atividade.');
  }
  const stage = row.stages.find(s => s.key === command.stageKey);
  if (['CLOSE', 'PUBLISH'].includes(command.action)) {
    if (command.stageKey) invalid('Comando do processo não recebe etapa.');
    if (command.action === 'CLOSE') {
      if (row.status === 'COMPLETED' || row.stages.some(s => !['COMPLETED', 'SKIPPED'].includes(s.status))) {
        throw new AclWorkflowError('LOCKED', 'Conclua ou valide as dispensas de todas as etapas.');
      }
      row.status = 'COMPLETED';
    } else {
      if (row.status !== 'COMPLETED' || !row.performance || row.publishedSummary) {
        throw new AclWorkflowError('LOCKED', 'Resumo exige adesão concluída e ainda não publicada.');
      }
      if (aclHash(row.performance.body) !== row.performance.sha256) invalid('Integridade do desempenho indisponível.');
      row.publishedSummary = { ...summary(command.publicSummary), publishedAt: now };
    }
  } else {
    if (!stage || row.status === 'COMPLETED') throw new AclWorkflowError('LOCKED', 'Etapa indisponível para alteração.');
    if (['START', 'RESUME'].includes(command.action)) {
      if (stage.status !== (command.action === 'START' ? 'NOT_STARTED' : 'PAUSED')) throw new AclWorkflowError('LOCKED', 'Estado incompatível com iniciar ou retomar.');
      if (row.stages.some(s => s.active?.actorId === actor.actorId)) throw new AclWorkflowError('LOCKED', 'Pause a outra atividade antes de iniciar.');
      start(stage, actor, now); row.status = 'IN_PROGRESS';
    } else if (command.action === 'SKIP') {
      if (stage.status !== 'NOT_STARTED' || !['metering', 'custody', 'contract-registration'].includes(stage.key) ||
          !text(command.reason, 10, 500) || !text(command.evidenceRef, 1, 200)) invalid('Dispensa exige etapa condicional, justificativa e evidência aprovada.');
      stage.status = 'SKIPPED'; stage.skipReason = command.reason.trim(); stage.evidenceRef = command.evidenceRef;
      row.status = 'IN_PROGRESS';
    } else {
      if (stage.status !== 'RUNNING' || stage.active?.actorId !== actor.actorId) throw new AclWorkflowError('LOCKED', 'Inicie ou retome a etapa com seu usuário.');
      if (command.action === 'HEARTBEAT') stage.active.heartbeatAt = now;
      else if (command.action === 'PAUSE') {
        if (!command.pauseReason || !['AWAITING_CUSTOMER', 'ENDING_ACTIVITY', 'OTHER'].includes(command.pauseReason) ||
            command.pauseReason === 'OTHER' && !text(command.reason, 10, 500)) invalid('Selecione o motivo da pausa e justifique Outros.');
        stop(stage, now); stage.status = 'PAUSED';
      } else if (command.action === 'COMPLETE') {
        if (!text(command.evidenceRef, 1, 200)) invalid('Concluir exige referência de evidência validada.');
        stop(stage, now); stage.status = 'COMPLETED'; stage.evidenceRef = command.evidenceRef;
      } else invalid('Comando não permitido.');
    }
  }
  row.revision++;
  row.events.push({ revision: row.revision, requestId: command.requestId, fingerprint, action: command.action,
    actorId: actor.actorId, actorName: actor.actorName, at: now,
    ...(stage ? { stageKey: stage.key, elapsedMs: stage.elapsedMs } : {}),
    ...(command.reason ? { reason: command.reason.trim() } : {}),
    ...(command.pauseReason ? { pauseReason: command.pauseReason } : {}) });
  if (command.action === 'CLOSE') {
    const body: Performance = { formatVersion: ACL_WORKFLOW_VERSION, organizationId: row.organizationId,
      admissionId: row.id, customerId: row.customerId, unitId: row.unitId, revision: row.revision, closedAt: now,
      activeMs: row.stages.reduce((n, s) => n + s.elapsedMs, 0), calendarMs: now - row.createdAt,
      stages: clone(row.stages), events: clone(row.events) };
    row.performance = { body, sha256: aclHash(body) };
  }
  return row;
}
export function aclProgress(row: Admission) {
  const applicable = row.stages.filter(s => s.status !== 'SKIPPED');
  const completed = applicable.filter(s => s.status === 'COMPLETED').length;
  return { completed, total: applicable.length, skipped: row.stages.length - applicable.length,
    percent: applicable.length ? Math.floor(completed * 100 / applicable.length) : 0 };
}
/** Call only after binding the authenticated external client and its authorized
 * units. A broad organization membership must never supply this binding.
 */
export function aclPortalProjection(row: Admission, binding: {
  organizationId: string; customerId: string; unitIds: readonly string[];
}) {
  if (row.organizationId !== binding.organizationId || row.customerId !== binding.customerId || !binding.unitIds.includes(row.unitId)) {
    throw new AclWorkflowError('FORBIDDEN', 'Adesão indisponível para este cliente.');
  }
  const status = row.status === 'COMPLETED' ? 'CONCLUDED' : row.status === 'DRAFT' ? 'NOT_STARTED' : 'IN_PROGRESS';
  const result: { unitId: string; status: string; summary?: { modality: Modality; supplyDate: string; conclusion: string; publishedAt: number } } = { unitId: row.unitId, status };
  if (row.status === 'COMPLETED' && row.publishedSummary) {
    const s = row.publishedSummary;
    result.summary = { modality: s.modality, supplyDate: s.supplyDate, conclusion: s.conclusion, publishedAt: s.publishedAt };
  }
  return result;
}
