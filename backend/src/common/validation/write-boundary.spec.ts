import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { CustomersService } from '../../modules/customers/services/customers.service';
import { ConsumerUnitsService } from '../../modules/consumer-units/services/consumer-units.service';
import { ContractsService } from '../../modules/contracts/services/contracts.service';
import { DocumentsService } from '../../modules/documents/services/documents.service';

describe('Service write boundaries', () => {
  const getClient = jest.fn();
  const supabase = { getClient } as any;
  const licenses = { requireEntitlement: jest.fn().mockResolvedValue(undefined) } as any;
  const services = [
    ['customers', new CustomersService(supabase)],
    ['consumer units', new ConsumerUnitsService(supabase)],
    ['contracts', new ContractsService(supabase, licenses)],
    ['documents', new DocumentsService(supabase, licenses)],
  ] as const;

  beforeEach(() => {
    getClient.mockReset();
    licenses.requireEntitlement.mockReset().mockResolvedValue(undefined);
  });

  describe.each(services)('%s', (_name, service) => {
    it.each(['organization_id', 'id', 'created_at', 'validated_by', 'permissions'])(
      'rejects protected or unknown field %s before touching persistence', async field => {
        await expect(service.update('record-a', 'org-a', { [field]: 'injected' } as any))
          .rejects.toBeInstanceOf(BadRequestException);
        expect(getClient).not.toHaveBeenCalled();
      },
    );
    it.each([{}, null, [], 'invalid'])(
      'rejects empty or non-object updates (%p)', async body => {
        await expect(service.update('record-a', 'org-a', body as any))
          .rejects.toBeInstanceOf(BadRequestException);
        expect(getClient).not.toHaveBeenCalled();
      },
    );
    it('rejects creation with unknown fields', async () => {
      await expect(service.create({ id: 'injected' } as any, 'org-a'))
        .rejects.toBeInstanceOf(BadRequestException);
      expect(getClient).not.toHaveBeenCalled();
    });
  });

  it('requires a licensed free-market module before contract creation', async () => {
    licenses.requireEntitlement.mockRejectedValue(new ForbiddenException('License inactive'));
    await expect(new ContractsService(supabase, licenses).create({} as any, 'org-a'))
      .rejects.toBeInstanceOf(ForbiddenException);
    expect(licenses.requireEntitlement).toHaveBeenCalledWith('org-a', 'free_market_management');
    expect(getClient).not.toHaveBeenCalled();
  });
});
