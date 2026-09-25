import { ContractsService } from './contracts.service';

describe('Contract persistence boundary', () => {
  const id = '00000000-0000-4000-8000-000000000001';
  const body = { consumerUnitId: id, contractNumber: 'C-1', contractType: 'ENERGY_PURCHASE', contractedVolumeMwh: 100, currentPrice: 250, startDate: '2026-01-01', endDate: '2026-12-31' };
  let queries: any, from: jest.Mock, entitlement: jest.Mock, service: ContractsService;
  const query = (data: any) => {
    const q: any = {};
    for (const name of ['select','eq','is','insert','update','delete']) q[name] = jest.fn(() => q);
    q.single = jest.fn().mockResolvedValue({ data, error: null });
    q.maybeSingle = jest.fn().mockResolvedValue({ data, error: null });
    return q;
  };
  beforeEach(() => {
    queries = { consumer_units: query({ id, customer_id: id }), customers: query({ id }), management_contracts: query({ id }), energy_contracts: query({ id, status: 'DRAFT', start_date: '2026-01-01T00:00:00' }) };
    from = jest.fn(table => queries[table]);
    entitlement = jest.fn();
    service = new ContractsService({ getClient: () => ({ from }) } as any, { requireEntitlement: entitlement } as any);
  });
  it('maps fields and scopes all parents', async () => {
    await service.create({ ...body, managementContractId: id, notes: 'Terms' }, 'org-a');
    expect(entitlement).toHaveBeenCalledWith('org-a', 'free_market_management');
    for (const table of ['consumer_units','customers','management_contracts']) expect(queries[table].eq).toHaveBeenCalledWith('organization_id', 'org-a');
    expect(queries.customers.is).toHaveBeenCalledWith('deleted_at', null);
    expect(queries.management_contracts.eq).toHaveBeenCalledWith('customer_id', id);
    expect(queries.energy_contracts.insert).toHaveBeenCalledWith([expect.objectContaining({ organization_id: 'org-a', customer_id: id, consumer_unit_id: id, contract_number: 'C-1', contract_type: 'ENERGY_PURCHASE', contracted_volume_mwh: 100, current_price: 250, start_date: '2026-01-01', status: 'DRAFT', notes: 'Terms' })]);
  });
  it.each([{ currentPrice: undefined }, { currentPrice: -1 }, { contractedVolumeMwh: NaN }, { contractType: 'BAD' }, { contractNumber: ' ' }, { startDate: '2026-02-30' }, { endDate: '2025-12-31' }, { startDate: '2026-01-01T00:00:00Z' }, { status: 'APPROVED' }, { status: null }, { minimumSavings: 3 }, { honorariePercentage: 5 }, { organization_id: 'org-b' }])('rejects invalid creation %p', async invalid => {
    await expect(service.create({ ...body, ...invalid } as any, 'org-a')).rejects.toMatchObject({ status: 400 });
    expect(from).not.toHaveBeenCalled();
  });
  it.each(['consumer_units', 'customers', 'management_contracts'])('rejects absent or foreign parent %s', async table => {
    queries[table].maybeSingle.mockResolvedValue({ data: null, error: null });
    await expect(service.create({ ...body, managementContractId: id }, 'org-a')).rejects.toMatchObject({ status: 404 });
    expect(queries.energy_contracts.insert).not.toHaveBeenCalled();
  });
  it('requires entitlement before inserting', async () => {
    entitlement.mockRejectedValue(new Error('license required'));
    await expect(service.create(body, 'org-a')).rejects.toThrow('license required');
    expect(from).not.toHaveBeenCalled();
  });
  it.each(['ACTIVE','APPROVED','PAUSED','TERMINATED','EXPIRED'])('preserves historical %s contract', async status => {
    queries.energy_contracts.maybeSingle.mockResolvedValue({ data: { id, status }, error: null });
    await expect(service.update(id, 'org-a', { currentPrice: 200 })).rejects.toMatchObject({ status: 409 });
    await expect(service.delete(id, 'org-a')).rejects.toMatchObject({ status: 409 });
    expect(queries.energy_contracts.update).not.toHaveBeenCalled();
    expect(queries.energy_contracts.delete).not.toHaveBeenCalled();
  });
  it('scopes activation to the still-current draft', async () => {
    await service.update(id, 'org-a', { currentPrice: 200, status: 'ACTIVE' });
    expect(queries.energy_contracts.update).toHaveBeenCalledWith({ current_price: 200, status: 'ACTIVE' });
    expect(queries.energy_contracts.eq).toHaveBeenCalledWith('status', 'DRAFT');
  });
  it('detects concurrent activation', async () => {
    queries.energy_contracts.maybeSingle.mockResolvedValueOnce({ data: { id, status: 'DRAFT' }, error: null }).mockResolvedValueOnce({ data: null, error: null });
    await expect(service.update(id, 'org-a', { currentPrice: 200 })).rejects.toMatchObject({ status: 409 });
  });
  it('rejects invalid draft chronology', async () => {
    await expect(service.update(id, 'org-a', { endDate: '2025-01-01' })).rejects.toMatchObject({ status: 400 });
    expect(queries.energy_contracts.update).not.toHaveBeenCalled();
  });
  it('returns 404 for foreign read/update/delete', async () => {
    queries.energy_contracts.maybeSingle.mockResolvedValue({ data: null, error: null });
    await expect(service.findOne(id, 'org-b')).rejects.toMatchObject({ status: 404 });
    await expect(service.update(id, 'org-b', { currentPrice: 200 })).rejects.toMatchObject({ status: 404 });
    await expect(service.delete(id, 'org-b')).rejects.toMatchObject({ status: 404 });
  });
  it('sanitizes database errors and translates duplicates', async () => {
    queries.energy_contracts.single.mockResolvedValue({ data: null, error: { code: '23505', message: 'secret' } });
    await expect(service.create(body, 'org-a')).rejects.toMatchObject({ status: 409 });
    queries.energy_contracts.single.mockResolvedValue({ data: null, error: { code: 'XX000', message: 'secret' } });
    await expect(service.create(body, 'org-a')).rejects.toThrow('Não foi possível consultar ou salvar os contratos.');
  });
  it.each(['list','read','update','delete'])('blocks %s before database access when entitlement is denied', async action => {
    entitlement.mockRejectedValue(new Error('license required'));
    const run = action === 'list' ? () => service.findAll('org-a') : action === 'read' ? () => service.findOne(id,'org-a') : action === 'update' ? () => service.update(id,'org-a',{status:'ACTIVE'}) : () => service.delete(id,'org-a');
    await expect(run()).rejects.toThrow('license required');
    expect(from).not.toHaveBeenCalled();
  });
});
