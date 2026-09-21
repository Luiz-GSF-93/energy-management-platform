import { PERMISSIONS } from '../../../common/constants/permissions';
import { PERMISSIONS_KEY } from '../../../common/decorators/require-permission.decorator';
import { LicensesController } from './licenses.controller';

describe('LicensesController', () => {
  const create = jest.fn();
  const resolveEffectiveLicense = jest.fn();

  const service: any = {
    create,
    resolveEffectiveLicense,
  };

  const controller = new LicensesController(service);

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('requires organization license create permission', () => {
    const permissions = Reflect.getMetadata(
      PERMISSIONS_KEY,
      LicensesController.prototype.create,
    );

    expect(permissions).toEqual([
      PERMISSIONS.ORGANIZATION_LICENSES_CREATE,
    ]);
  });

  it('creates using validated tenant and request audit context', async () => {
    const dto: any = {
      licenseType: 'foundation',
      documentsLimit: 100,
      renewalDate: '2027-01-01',
      startDate: '2026-09-21',
    };

    const tenant: any = {
      userId: 'user-1',
      organizationId: 'org-1',
    };

    const request: any = {
      ip: '203.0.113.10',
      get: jest.fn((name: string) =>
        name === 'user-agent' ? 'F1.4i.2-test' : undefined,
      ),
    };

    const created = { id: 'license-1' };
    create.mockResolvedValue(created);

    await expect(
      controller.create(dto, tenant, request),
    ).resolves.toEqual(created);

    expect(create).toHaveBeenCalledTimes(1);
    expect(create).toHaveBeenCalledWith(dto, {
      actorUserId: tenant.userId,
      organizationId: tenant.organizationId,
      ipAddress: request.ip,
      userAgent: 'F1.4i.2-test',
    });

    expect(request.get).toHaveBeenCalledWith('user-agent');
  });

  it('requires organization license view permission', () => {
    const permissions = Reflect.getMetadata(
      PERMISSIONS_KEY,
      LicensesController.prototype.findEffective,
    );

    expect(permissions).toEqual([
      PERMISSIONS.ORGANIZATION_LICENSES_VIEW,
    ]);
  });

  it('resolves the effective license using the validated tenant organization', async () => {
    const effectiveLicense = { id: 'license-1' };
    resolveEffectiveLicense.mockResolvedValue(effectiveLicense);

    const tenant: any = {
      userId: 'user-1',
      organizationId: 'org-1',
    };

    await expect(
      controller.findEffective(tenant),
    ).resolves.toEqual(effectiveLicense);

    expect(resolveEffectiveLicense).toHaveBeenCalledTimes(1);
    expect(resolveEffectiveLicense).toHaveBeenCalledWith('org-1');
  });
});
