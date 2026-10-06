import { randomUUID } from 'crypto';
import { aclHash, aclPortalProjection, aclProgress, ACL_LEASE_MS, Admission,
  Command, createAclAdmission, executeAclCommand, Operator, reconcileAclLeases } from './acl-workflow';

const time = Date.UTC(2026, 9, 6, 12);
const operator: Operator = { organizationId: 'org-a', actorId: 'operator-a', actorName: 'Consultor A', canWork: true, canApprove: false };
const approver: Operator = { ...operator, canApprove: true };
const binding = { organizationId: 'org-a', customerId: 'customer-a', unitIds: ['unit-a'] };
function initial() { return createAclAdmission({ id: 'admission-a', organizationId: 'org-a', customerId: 'customer-a', unitId: 'unit-a' }, time); }
function command(row: Admission, action: Command['action'], extra: Partial<Command> = {}): Command {
  return { requestId: randomUUID(), expectedRevision: row.revision, action, ...extra };
}
function run(row: Admission, action: Command['action'], at: number, extra: Partial<Command> = {}, actor = operator) {
  return executeAclCommand(row, command(row, action, extra), actor, at);
}
function closed() {
  let row = initial(); let at = time;
  for (const stage of row.stages) {
    row = run(row, 'START', at, { stageKey: stage.key });
    row = run(row, 'COMPLETE', at + 1000, { stageKey: stage.key, evidenceRef: 'validated-version-1' }); at += 2000;
  }
  return run(row, 'CLOSE', at, {}, approver);
}
describe('ACL admission domain checkpoint', () => {
  it('accumulates active time across pauses without charging the waiting interval', () => {
    let row = run(initial(), 'START', time, { stageKey: 'invoices' });
    row = run(row, 'PAUSE', time + 5000, { stageKey: 'invoices', pauseReason: 'AWAITING_CUSTOMER' });
    row = run(row, 'RESUME', time + 3600000, { stageKey: 'invoices' });
    row = run(row, 'COMPLETE', time + 3602000, { stageKey: 'invoices', evidenceRef: 'reviewed-invoices-1' });
    expect(row.stages.find(s => s.key === 'invoices')?.elapsedMs).toBe(7000);
    expect(row.events.map(e => e.action)).toEqual(['START', 'PAUSE', 'RESUME', 'COMPLETE']);
  });
  it('blocks commands while paused and rejects a different operator on an active stage', () => {
    const row = run(initial(), 'START', time, { stageKey: 'invoices' });
    expect(() => run(row, 'COMPLETE', time + 1000, { stageKey: 'invoices', evidenceRef: 'x' }, { ...operator, actorId: 'operator-b' })).toThrow('seu usuário');
    const paused = run(row, 'PAUSE', time + 1000, { stageKey: 'invoices', pauseReason: 'ENDING_ACTIVITY' });
    expect(() => run(paused, 'COMPLETE', time + 2000, { stageKey: 'invoices', evidenceRef: 'x' })).toThrow('seu usuário');
    expect(() => run(paused, 'HEARTBEAT', time + 2000, { stageKey: 'invoices' })).toThrow('seu usuário');
  });
  it('requires a valid pause reason and a justification for OTHER', () => {
    const row = run(initial(), 'START', time, { stageKey: 'invoices' });
    expect(() => run(row, 'PAUSE', time + 1000, { stageKey: 'invoices' })).toThrow('motivo');
    expect(() => run(row, 'PAUSE', time + 1000, { stageKey: 'invoices', pauseReason: 'OTHER', reason: 'x' })).toThrow('motivo');
    expect(row.revision).toBe(2);
  });
  it('denies cross-organization work, revoked capabilities and unauthorized approval', () => {
    const row = initial(); const cmd = command(row, 'START', { stageKey: 'registration' });
    expect(() => executeAclCommand(row, cmd, { ...operator, organizationId: 'org-b' }, time)).toThrow('Acesso');
    expect(() => executeAclCommand(row, cmd, { ...operator, canWork: false }, time)).toThrow('Acesso');
    expect(() => run(row, 'SKIP', time, { stageKey: 'custody', reason: 'Varejista representa este cliente', evidenceRef: 'reviewed' })).toThrow('Acesso');
  });
  it('keeps source immutable and replays the same request without double time or events', () => {
    const source = initial(); const original = JSON.stringify(source);
    const cmd = command(source, 'START', { stageKey: 'registration' });
    const result = executeAclCommand(source, cmd, operator, time);
    const replay = executeAclCommand(result, cmd, operator, time + 1000);
    expect(JSON.stringify(source)).toBe(original); expect(replay).toEqual(result);
    expect(() => executeAclCommand(result, { ...cmd, stageKey: 'invoices' }, operator, time + 1000)).toThrow('Requisição');
    expect(() => executeAclCommand(result, cmd, { ...operator, canWork: false }, time + 1000)).toThrow('Acesso');
  });
  it('rejects stale concurrent commands and prevents one operator running two stages', () => {
    const before = initial(); const stale = command(before, 'START', { stageKey: 'invoices' });
    const row = run(before, 'START', time, { stageKey: 'registration' });
    expect(() => executeAclCommand(row, stale, operator, time + 1000)).toThrow('Atualize');
    expect(() => run(row, 'START', time + 1000, { stageKey: 'invoices' })).toThrow('outra atividade');
    const second = run(row, 'START', time + 1000, { stageKey: 'invoices' }, { ...operator, actorId: 'operator-b' });
    expect(second.stages.filter(s => s.active).length).toBe(2);
  });
  it('expires disconnected work at the last confirmed heartbeat and requires explicit resume', () => {
    let row = run(initial(), 'START', time, { stageKey: 'registration' });
    row = run(row, 'HEARTBEAT', time + 10000, { stageKey: 'registration' });
    const disconnectedAt = time + 10000 + ACL_LEASE_MS;
    expect(() => run(row, 'COMPLETE', disconnectedAt, { stageKey: 'registration', evidenceRef: 'x' })).toThrow('interrompida');
    const expired = reconcileAclLeases(row, operator, disconnectedAt);
    expect(expired.stages[0]).toMatchObject({ status: 'PAUSED', elapsedMs: 10000 });
    expect(expired.stages[0].active).toBeUndefined();
    expect(expired.events.at(-1)?.action).toBe('INTERRUPTED');
    expect(reconcileAclLeases(expired, operator, disconnectedAt + 1000)).toEqual(expired);
    expect(run(expired, 'RESUME', disconnectedAt + 1000, { stageKey: 'registration' }).stages[0].status).toBe('RUNNING');
  });
  it('rejects backwards or nonfinite server times', () => {
    const row = run(initial(), 'START', time, { stageKey: 'registration' });
    expect(() => run(row, 'HEARTBEAT', time - 1, { stageKey: 'registration' })).toThrow('anterior');
    expect(() => run(row, 'HEARTBEAT', NaN, { stageKey: 'registration' })).toThrow('Instante');
    expect(() => reconcileAclLeases(row, operator, time - 1)).toThrow('anterior');
  });
  it('only allows justified conditional dispensations and shows them separately from completed work', () => {
    let row = initial();
    expect(() => run(row, 'SKIP', time, { stageKey: 'registration', reason: 'Cliente não entregou documentos', evidenceRef: 'x' }, approver)).toThrow('Dispensa');
    row = run(row, 'SKIP', time, { stageKey: 'custody', reason: 'Representação por agente varejista', evidenceRef: 'reviewed-modality' }, approver);
    expect(aclProgress(row)).toEqual({ completed: 0, total: 11, skipped: 1, percent: 0 });
    expect(() => run(row, 'CLOSE', time + 1000, {}, approver)).toThrow('todas as etapas');
  });
  it('requires evidence to conclude and cannot mutate stages after closing', () => {
    const row = run(initial(), 'START', time, { stageKey: 'registration' });
    expect(() => run(row, 'COMPLETE', time + 1000, { stageKey: 'registration' })).toThrow('evidência');
    const final = closed();
    expect(final.performance?.body.activeMs).toBe(12000);
    expect(final.performance?.sha256).toBe(aclHash(final.performance?.body));
    expect(aclProgress(final).percent).toBe(100);
    expect(() => run(final, 'RESUME', time + 30000, { stageKey: 'registration' })).toThrow('indisponível');
  });
  it('preserves operator names as recorded when a performance version is closed', () => {
    const row = closed(); const body = row.performance!.body;
    expect(body.events[0].actorName).toBe('Consultor A');
    const published = run(row, 'PUBLISH', time + 30000, { publicSummary: { modality: 'RETAIL', supplyDate: '2026-11-01', conclusion: 'Adesão concluída com suprimento confirmado.' } }, { ...approver, actorName: 'Novo nome' });
    expect(published.performance).toEqual(row.performance);
  });
  it('returns only public status before publication and never exposes internal workflow fields', () => {
    const open = run(initial(), 'START', time, { stageKey: 'registration' });
    expect(aclPortalProjection(open, binding)).toEqual({ unitId: 'unit-a', status: 'IN_PROGRESS' });
    expect(aclPortalProjection(closed(), binding)).toEqual({ unitId: 'unit-a', status: 'CONCLUDED' });
    expect(() => aclPortalProjection(open, { ...binding, organizationId: 'org-b' })).toThrow('cliente');
    expect(() => aclPortalProjection(open, { ...binding, customerId: 'customer-b' })).toThrow('cliente');
    expect(() => aclPortalProjection(open, { ...binding, unitIds: ['unit-b'] })).toThrow('cliente');
  });
  it('requires approval and completed work before publishing a summary', () => {
    const publicSummary = { modality: 'RETAIL' as const, supplyDate: '2026-11-01', conclusion: 'Adesão concluída e suprimento confirmado.' };
    expect(() => run(initial(), 'PUBLISH', time, { publicSummary }, approver)).toThrow('concluída');
    expect(() => run(closed(), 'PUBLISH', time + 30000, { publicSummary })).toThrow('Acesso');
    const result = run(closed(), 'PUBLISH', time + 30000, { publicSummary }, approver);
    const projection = aclPortalProjection(result, binding);
    expect(Object.keys(projection).sort()).toEqual(['status', 'summary', 'unitId']);
    expect(projection.summary).toEqual({ ...publicSummary, publishedAt: time + 30000 });
    expect(() => run(result, 'PUBLISH', time + 31000, { publicSummary }, approver)).toThrow('publicada');
  });
  it('rejects corrupted snapshots and invalid dates without leaking internal fields', () => {
    const row = closed(); row.performance!.body.activeMs++;
    expect(() => run(row, 'PUBLISH', time + 30000, { publicSummary: { modality: 'RETAIL', supplyDate: '2026-11-01', conclusion: 'Conclusão confirmada.' } }, approver)).toThrow('Integridade');
    for (const supplyDate of ['2026-02-30', '2026-99-99', 'abc']) {
      expect(() => run(closed(), 'PUBLISH', time + 30000, { publicSummary: { modality: 'RETAIL', supplyDate, conclusion: 'Conclusão confirmada.' } }, approver)).toThrow('Confira');
    }
  });
});
