import { PERMISSIONS } from '../../../common/constants/permissions';
import { PERMISSIONS_KEY } from '../../../common/decorators/require-permission.decorator';
import { ContractsController } from './contracts.controller';

describe('ContractsController permissions', () => {
  const permissionOf = (method: keyof ContractsController) =>
    Reflect.getMetadata(
      PERMISSIONS_KEY,
      ContractsController.prototype[method],
    );

  it('requires create permission', () => {
    expect(permissionOf('create')).toEqual([
      PERMISSIONS.ORGANIZATION_CONTRACTS_CREATE,
    ]);
  });

  it('requires view permission for list', () => {
    expect(permissionOf('findAll')).toEqual([
      PERMISSIONS.ORGANIZATION_CONTRACTS_VIEW,
    ]);
  });

  it('requires view permission for single read', () => {
    expect(permissionOf('findOne')).toEqual([
      PERMISSIONS.ORGANIZATION_CONTRACTS_VIEW,
    ]);
  });

  it('requires update permission', () => {
    expect(permissionOf('update')).toEqual([
      PERMISSIONS.ORGANIZATION_CONTRACTS_UPDATE,
    ]);
  });

  it('requires delete permission', () => {
    expect(permissionOf('delete')).toEqual([
      PERMISSIONS.ORGANIZATION_CONTRACTS_DELETE,
    ]);
  });
});
