import { ForbiddenException } from '@nestjs/common';
import {
  LicenseRecord,
  LicensesService,
} from './licenses.service';

describe('LicensesService entitlement', () => {
  const organizationId = 'org-1';

  const license: LicenseRecord = {
    id: 'license-1',
    organization_id: organizationId,
    license_type: 'standard',
    documents_limit: 100,
    documents_used: 0,
    renewal_date: '2027-01-01',
    active: true,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    status: 'ACTIVE',
    max_consumer_units: 10,
    document_management: true,
    advanced_analytics: false,
    report_generation: false,
    free_market_management: false,
    start_date: '2026-01-01',
    end_date: null,
  };

  const createService = () => {
    const service = new LicensesService(
      {} as any,
      {} as any,
    );

    return service;
  };

  it('grants when the effective license explicitly enables the capability', async () => {
    const service = createService();

    jest
      .spyOn(service, 'resolveEffectiveLicense')
      .mockResolvedValue(license);

    await expect(
      service.requireEntitlement(
        organizationId,
        'document_management',
      ),
    ).resolves.toBe(license);

    expect(service.resolveEffectiveLicense).toHaveBeenCalledWith(
      organizationId,
    );
  });

  it('denies when no effective license exists', async () => {
    const service = createService();

    jest
      .spyOn(service, 'resolveEffectiveLicense')
      .mockResolvedValue(null);

    await expect(
      service.requireEntitlement(
        organizationId,
        'document_management',
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('denies when the capability is false', async () => {
    const service = createService();

    jest
      .spyOn(service, 'resolveEffectiveLicense')
      .mockResolvedValue({
        ...license,
        document_management: false,
      });

    await expect(
      service.requireEntitlement(
        organizationId,
        'document_management',
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('denies when the capability is null', async () => {
    const service = createService();

    jest
      .spyOn(service, 'resolveEffectiveLicense')
      .mockResolvedValue({
        ...license,
        document_management: null,
      });

    await expect(
      service.requireEntitlement(
        organizationId,
        'document_management',
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('propagates effective-license resolution failures fail-closed', async () => {
    const service = createService();
    const failure = new Error('resolution failed');

    jest
      .spyOn(service, 'resolveEffectiveLicense')
      .mockRejectedValue(failure);

    await expect(
      service.requireEntitlement(
        organizationId,
        'document_management',
      ),
    ).rejects.toBe(failure);
  });
});
