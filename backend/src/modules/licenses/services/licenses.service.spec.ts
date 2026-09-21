import { InternalServerErrorException } from '@nestjs/common';
import { LicensesService, LicenseRecord } from './licenses.service';

const TODAY = '2026-09-21';

const license = (
  overrides: Partial<LicenseRecord> = {},
): LicenseRecord => ({
  id: 'license-1',
  organization_id: 'org-1',
  license_type: 'foundation',
  documents_limit: 100,
  documents_used: 0,
  renewal_date: '2027-01-01',
  active: true,
  created_at: null,
  updated_at: null,
  status: 'ACTIVE',
  max_consumer_units: 10,
  document_management: true,
  advanced_analytics: false,
  report_generation: false,
  free_market_management: false,
  start_date: TODAY,
  end_date: null,
  ...overrides,
});

const createService = (data: LicenseRecord[] | null, error: any = null) => {
  const query: any = {};
  query.select = jest.fn(() => query);
  query.eq = jest.fn(() => query);
  query.then = (resolve: any) => resolve({ data, error });

  const supabaseService: any = {
    getClient: () => ({
      from: jest.fn(() => query),
    }),
  };

  return new LicensesService(supabaseService);
};

describe('LicensesService.resolveEffectiveLicense', () => {
  it('returns null when no effective license exists', async () => {
    const service = createService([]);

    await expect(
      service.resolveEffectiveLicense('org-1', TODAY),
    ).resolves.toBeNull();
  });

  it('returns exactly one effective license', async () => {
    const current = license();
    const service = createService([current]);

    await expect(
      service.resolveEffectiveLicense('org-1', TODAY),
    ).resolves.toEqual(current);
  });

  it('treats start_date equal to today as effective', async () => {
    const current = license({ start_date: TODAY });
    const service = createService([current]);

    await expect(
      service.resolveEffectiveLicense('org-1', TODAY),
    ).resolves.toEqual(current);
  });

  it('treats end_date equal to today as effective', async () => {
    const current = license({ end_date: TODAY });
    const service = createService([current]);

    await expect(
      service.resolveEffectiveLicense('org-1', TODAY),
    ).resolves.toEqual(current);
  });

  it('rejects inactive, invalid-status, future, expired, malformed and foreign candidates', async () => {
    const service = createService([
      license({ id: 'inactive', active: false }),
      license({ id: 'suspended', status: 'suspended', active: false }),
      license({ id: 'future', start_date: '2026-09-22' }),
      license({ id: 'expired', end_date: '2026-09-20' }),
      license({ id: 'malformed', start_date: null }),
      license({ id: 'foreign', organization_id: 'org-2' }),
    ]);

    await expect(
      service.resolveEffectiveLicense('org-1', TODAY),
    ).resolves.toBeNull();
  });

  it('fails closed when effective state is ambiguous', async () => {
    const service = createService([
      license({ id: 'license-1' }),
      license({ id: 'license-2' }),
    ]);

    await expect(
      service.resolveEffectiveLicense('org-1', TODAY),
    ).rejects.toBeInstanceOf(InternalServerErrorException);
  });

  it('fails closed on database error', async () => {
    const service = createService(null, { message: 'database failure' });

    await expect(
      service.resolveEffectiveLicense('org-1', TODAY),
    ).rejects.toBeInstanceOf(InternalServerErrorException);
  });
});
