import { PERMISSIONS } from '../../../common/constants/permissions';
import { PERMISSIONS_KEY } from '../../../common/decorators/require-permission.decorator';
import { LicensesController } from './licenses.controller';

describe('LicensesController', () => {
  const create = jest.fn();
  const update = jest.fn();
  const resolveEffectiveLicense = jest.fn();

  const service: any = {
    create,
    update,
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

  it.each(['create','update'] as const)('denies organization-managed %s even with license permissions',async method=>{
    const call=method==='create'?controller.create({} as any,{} as any,{} as any):controller.update('id',{} as any,{} as any,{} as any);
    await expect(call).rejects.toMatchObject({status:403});expect(create).not.toHaveBeenCalled();expect(update).not.toHaveBeenCalled();
  });
  it.each(['create','update'] as const)('requires catalog route for platform %s',async method=>{
    const ctx:any={accessMode:'platform_operation'};
    const call=method==='create'?controller.create({} as any,ctx,{} as any):controller.update('id',{} as any,ctx,{} as any);
    await expect(call).rejects.toMatchObject({status:400});expect(create).not.toHaveBeenCalled();expect(update).not.toHaveBeenCalled();
  });
  it('requires organization license update permission', () => {
    const permissions = Reflect.getMetadata(
      PERMISSIONS_KEY,
      LicensesController.prototype.update,
    );

    expect(permissions).toEqual([
      PERMISSIONS.ORGANIZATION_LICENSES_UPDATE,
    ]);
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
