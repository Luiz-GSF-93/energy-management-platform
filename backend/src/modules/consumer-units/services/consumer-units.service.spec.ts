import { BadRequestException, ConflictException, InternalServerErrorException, NotFoundException } from '@nestjs/common';
import { ConsumerUnitsService } from './consumer-units.service';

describe('Consumer-unit persistence contract', () => {
  const customerId = '00000000-0000-4000-8000-000000000001';
  const body = { customerId, name: 'Factory', code: 'UC-001', distributor: 'Distributor', tariffGroup: 'A4' };
  let customer: any;
  let units: any;
  let service: ConsumerUnitsService;
  let from: jest.Mock;
  function query(result: any) {
    const q: any = {};
    for (const name of ['select', 'eq', 'is', 'insert', 'update', 'delete']) q[name] = jest.fn(() => q);
    q.single = jest.fn().mockResolvedValue(result);
    q.maybeSingle = jest.fn().mockResolvedValue(result);
    return q;
  }
  beforeEach(() => {
    customer = query({ data: { id: customerId }, error: null });
    units = query({ data: { id: 'unit-a' }, error: null });
    from = jest.fn(table => table === 'customers' ? customer : units);
    service = new ConsumerUnitsService({ getClient: () => ({ from }) } as any);
  });

  it('maps API names to schema and checks the parent organization', async () => {
    await service.create({ ...body, installedCapacity: 100, contractedDemand: 80, voltageClass: '13.8', tariffModality: 'GREEN', address: 'Street', city: 'City', state: 'SP' }, 'org-a');
    expect(customer.eq.mock.calls).toEqual([['id', customerId], ['organization_id', 'org-a']]);
    expect(customer.is).toHaveBeenCalledWith('deleted_at', null);
    expect(units.insert).toHaveBeenCalledWith([{
      organization_id: 'org-a', customer_id: customerId, name: 'Factory', consumer_unit_number: 'UC-001',
      distributor: 'Distributor', tariff_group: 'A4', installed_capacity: 100, contracted_demand: 80,
      voltage: '13.8', tariff_modality: 'GREEN', address: 'Street', city: 'City', state: 'SP',
    }]);
  });

  it('leaves optional defaults to PostgreSQL', async () => {
    await service.create(body, 'org-a');
    expect(units.insert.mock.calls[0][0][0]).not.toHaveProperty('tariff_modality');
    expect(units.insert.mock.calls[0][0][0]).not.toHaveProperty('contracted_demand');
  });

  it('does not insert for a foreign, missing or deleted customer', async () => {
    customer.maybeSingle.mockResolvedValue({ data: null, error: null });
    await expect(service.create(body, 'org-b')).rejects.toBeInstanceOf(NotFoundException);
    expect(customer.eq).toHaveBeenCalledWith('organization_id', 'org-b');
    expect(units.insert).not.toHaveBeenCalled();
  });

  it.each([
    { distributor: undefined }, { tariffGroup: undefined }, { code: 'x'.repeat(21) },
    { name: '  ' }, { distributor: null }, { tariffModality: null }, { tariffModality: 'INVALID' },
    { installedCapacity: -1 }, { contractedDemand: -1 }, { voltageClass: 'x'.repeat(21) },
  ])('rejects invalid create data before persistence: %p', async invalid => {
    await expect(service.create({ ...body, ...invalid } as any, 'org-a')).rejects.toBeInstanceOf(BadRequestException);
    expect(from).not.toHaveBeenCalled();
  });

  it('updates mapped fields without changing the customer or organization', async () => {
    await service.update('unit-a', 'org-a', { installedCapacity: 0, address: null, tariffGroup: 'A3', status: 'INACTIVE' } as any);
    expect(units.update).toHaveBeenCalledWith({ installed_capacity: 0, address: null, tariff_group: 'A3', status: 'INACTIVE' });
    expect(units.eq.mock.calls).toEqual([['id', 'unit-a'], ['organization_id', 'org-a']]);
  });

  it.each([{ customerId }, { tariffGroup: null }, { status: 'INVALID' }, { contractedDemand: -10 }])('rejects invalid updates: %p', async invalid => {
    await expect(service.update('unit-a', 'org-a', invalid as any)).rejects.toBeInstanceOf(BadRequestException);
    expect(from).not.toHaveBeenCalled();
  });

  it.each(['findOne', 'update', 'delete'] as const)('returns 404 for absent or foreign rows in %s', async method => {
    units.maybeSingle.mockResolvedValue({ data: null, error: null });
    const action = method === 'update' ? service.update('unit-b', 'org-a', { name: 'New' }) : service[method]('unit-b', 'org-a');
    await expect(action).rejects.toBeInstanceOf(NotFoundException);
    expect(units.eq).toHaveBeenCalledWith('organization_id', 'org-a');
  });

  it('reports duplicate unit number as conflict', async () => {
    units.single.mockResolvedValue({ data: null, error: { code: '23505', message: 'private database detail' } });
    await expect(service.create(body, 'org-a')).rejects.toBeInstanceOf(ConflictException);
  });

  it('does not leak database details when the parent lookup fails', async () => {
    customer.maybeSingle.mockResolvedValue({ data: null, error: { code: 'XX000', message: 'private database detail' } });
    await expect(service.create(body, 'org-a')).rejects.toThrow(new InternalServerErrorException('Unable to access consumer units'));
    expect(units.insert).not.toHaveBeenCalled();
  });
});
