import { PERMISSIONS } from '../../../common/constants/permissions';
import { PERMISSIONS_KEY } from '../../../common/decorators/require-permission.decorator';
import { ConsumerUnitsController } from './consumer-units.controller';

describe('ConsumerUnitsController permissions', () => {
  const permissionOf = (method: keyof ConsumerUnitsController) =>
    Reflect.getMetadata(
      PERMISSIONS_KEY,
      ConsumerUnitsController.prototype[method],
    );

  it('requires create permission', () => {
    expect(permissionOf('create')).toEqual([
      PERMISSIONS.ORGANIZATION_CONSUMER_UNITS_CREATE,
    ]);
  });

  it('requires view permission for list', () => {
    expect(permissionOf('findAll')).toEqual([
      PERMISSIONS.ORGANIZATION_CONSUMER_UNITS_VIEW,
    ]);
  });

  it('requires view permission for single read', () => {
    expect(permissionOf('findOne')).toEqual([
      PERMISSIONS.ORGANIZATION_CONSUMER_UNITS_VIEW,
    ]);
  });

  it('requires update permission', () => {
    expect(permissionOf('update')).toEqual([
      PERMISSIONS.ORGANIZATION_CONSUMER_UNITS_UPDATE,
    ]);
  });

  it('requires delete permission', () => {
    expect(permissionOf('delete')).toEqual([
      PERMISSIONS.ORGANIZATION_CONSUMER_UNITS_DELETE,
    ]);
  });
});
