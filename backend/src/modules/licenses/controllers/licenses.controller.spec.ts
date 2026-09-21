import { PERMISSIONS } from '../../../common/constants/permissions';
import { PERMISSIONS_KEY } from '../../../common/decorators/require-permission.decorator';
import { LicensesController } from './licenses.controller';

describe('LicensesController', () => {
  const resolveEffectiveLicense = jest.fn();

  const service: any = {
    resolveEffectiveLicense,
  };

  const controller = new LicensesController(service);

  beforeEach(() => {
    jest.clearAllMocks();
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
