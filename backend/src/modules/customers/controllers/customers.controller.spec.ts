import { PERMISSIONS } from '../../../common/constants/permissions';
import { PERMISSIONS_KEY } from '../../../common/decorators/require-permission.decorator';
import { CustomersController } from './customers.controller';

describe('CustomersController permissions', () => {
  const permissionOf = (method: keyof CustomersController) =>
    Reflect.getMetadata(
      PERMISSIONS_KEY,
      CustomersController.prototype[method],
    );

  it('requires create permission', () => {
    expect(permissionOf('create')).toEqual([
      PERMISSIONS.ORGANIZATION_CUSTOMERS_CREATE,
    ]);
  });

  it('requires view permission for list', () => {
    expect(permissionOf('findAll')).toEqual([
      PERMISSIONS.ORGANIZATION_CUSTOMERS_VIEW,
    ]);
  });

  it('requires view permission for single read', () => {
    expect(permissionOf('findOne')).toEqual([
      PERMISSIONS.ORGANIZATION_CUSTOMERS_VIEW,
    ]);
  });

  it('requires update permission', () => {
    expect(permissionOf('update')).toEqual([
      PERMISSIONS.ORGANIZATION_CUSTOMERS_UPDATE,
    ]);
  });

  it('requires delete permission', () => {
    expect(permissionOf('delete')).toEqual([
      PERMISSIONS.ORGANIZATION_CUSTOMERS_DELETE,
    ]);
  });
});
