import { PERMISSIONS } from '../../../common/constants/permissions';
import { PERMISSIONS_KEY } from '../../../common/decorators/require-permission.decorator';
import { DocumentsController } from './documents.controller';

describe('DocumentsController permissions', () => {
  const permissionOf = (method: keyof DocumentsController) =>
    Reflect.getMetadata(
      PERMISSIONS_KEY,
      DocumentsController.prototype[method],
    );

  it('requires upload permission for create', () => {
    expect(permissionOf('create')).toEqual([
      PERMISSIONS.DOCUMENTS_UPLOAD,
    ]);
  });

  it('requires view permission for list', () => {
    expect(permissionOf('findAll')).toEqual([
      PERMISSIONS.DOCUMENTS_VIEW,
    ]);
  });

  it('requires view permission for single read', () => {
    expect(permissionOf('findOne')).toEqual([
      PERMISSIONS.DOCUMENTS_VIEW,
    ]);
  });

  it('requires delete permission', () => {
    expect(permissionOf('delete')).toEqual([
      PERMISSIONS.DOCUMENTS_DELETE,
    ]);
  });
});
