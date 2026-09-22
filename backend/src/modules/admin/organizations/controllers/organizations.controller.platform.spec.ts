import { Reflector } from '@nestjs/core';
import { OrganizationsController } from './organizations.controller';
import { PLATFORM_SCOPE_KEY } from '../../../../common/decorators/platform-scope.decorator';
import { PERMISSIONS_KEY } from '../../../../common/decorators/require-permission.decorator';
import { PERMISSIONS } from '../../../../common/constants/permissions';

describe('OrganizationsController — Platform Admin contract', () => {
  const reflector = new Reflector();

  const controllerMetadata = () =>
    reflector.get<boolean>(
      PLATFORM_SCOPE_KEY,
      OrganizationsController,
    );

  const permissionFor = (method: keyof OrganizationsController) =>
    reflector.get<string[]>(
      PERMISSIONS_KEY,
      OrganizationsController.prototype[method],
    );

  it('A — controller is explicitly platform-scoped', () => {
    expect(controllerMetadata()).toBe(true);
  });

  it('B — findAll requires platform organizations view', () => {
    expect(permissionFor('findAll')).toEqual([
      PERMISSIONS.PLATFORM_ORGANIZATIONS_VIEW,
    ]);
  });

  it('C — findOne requires platform organizations view', () => {
    expect(permissionFor('findOne')).toEqual([
      PERMISSIONS.PLATFORM_ORGANIZATIONS_VIEW,
    ]);
  });

  it('D — create requires platform organizations create', () => {
    expect(permissionFor('create')).toEqual([
      PERMISSIONS.PLATFORM_ORGANIZATIONS_CREATE,
    ]);
  });

  it('E — update requires platform organizations update', () => {
    expect(permissionFor('update')).toEqual([
      PERMISSIONS.PLATFORM_ORGANIZATIONS_UPDATE,
    ]);
  });

  it('F — delete requires platform organizations delete', () => {
    expect(permissionFor('delete')).toEqual([
      PERMISSIONS.PLATFORM_ORGANIZATIONS_DELETE,
    ]);
  });

  it('G — delete forwards authenticated actor and never tenant organization context', async () => {
    const service = {
      delete: jest.fn().mockResolvedValue(undefined),
    };

    const controller = new OrganizationsController(service as any);

    const request: any = {
      authenticatedUser: {
        userId: 'platform-user',
        email: 'platform@example.test',
      },
      ip: '127.0.0.1',
      get: jest.fn((header: string) =>
        header === 'user-agent' ? 'phase-5.7-test' : undefined,
      ),
    };

    await expect(
      controller.delete('target-org', request),
    ).resolves.toEqual({
      message: 'Organization target-org deleted successfully',
    });

    expect(service.delete).toHaveBeenCalledTimes(1);
    expect(service.delete).toHaveBeenCalledWith(
      'target-org',
      {
        actorUserId: 'platform-user',
        ipAddress: '127.0.0.1',
        userAgent: 'phase-5.7-test',
      },
    );

    const auditContext = service.delete.mock.calls[0][1];

    expect(auditContext.organizationId).toBeUndefined();
    expect(auditContext.userId).toBeUndefined();
  });

  it('H — create forwards authenticated actor and never tenant organization context', async () => {
    const created = {
      id: 'created-org',
      name: 'Created',
      description: null,
      created_at: '2026-09-22T10:00:00.000Z',
      updated_at: '2026-09-22T10:00:00.000Z',
    };

    const service = {
      create: jest.fn().mockResolvedValue(created),
    };

    const controller = new OrganizationsController(service as any);

    const request: any = {
      authenticatedUser: {
        userId: 'platform-user',
        email: 'platform@example.test',
      },
      ip: '127.0.0.1',
      get: jest.fn((header: string) =>
        header === 'user-agent' ? 'f1.5.5-test' : undefined,
      ),
    };

    await expect(
      controller.create({ name: 'Created' }, request),
    ).resolves.toEqual(created);

    expect(service.create).toHaveBeenCalledWith(
      { name: 'Created' },
      {
        actorUserId: 'platform-user',
        ipAddress: '127.0.0.1',
        userAgent: 'f1.5.5-test',
      },
    );

    const auditContext = service.create.mock.calls[0][1];

    expect(auditContext.organizationId).toBeUndefined();
    expect(auditContext.userId).toBeUndefined();
  });

  it('I — update forwards authenticated actor and never tenant organization context', async () => {
    const updated = {
      id: 'target-org',
      name: 'Updated',
      description: null,
      created_at: '2026-09-20T00:00:00.000Z',
      updated_at: '2026-09-22T10:00:00.000Z',
    };

    const service = {
      update: jest.fn().mockResolvedValue(updated),
    };

    const controller = new OrganizationsController(service as any);

    const request: any = {
      authenticatedUser: {
        userId: 'platform-user',
        email: 'platform@example.test',
      },
      ip: '127.0.0.1',
      get: jest.fn((header: string) =>
        header === 'user-agent' ? 'f1.5.5-test' : undefined,
      ),
    };

    await expect(
      controller.update('target-org', { name: 'Updated' }, request),
    ).resolves.toEqual(updated);

    expect(service.update).toHaveBeenCalledWith(
      'target-org',
      { name: 'Updated' },
      {
        actorUserId: 'platform-user',
        ipAddress: '127.0.0.1',
        userAgent: 'f1.5.5-test',
      },
    );

    const auditContext = service.update.mock.calls[0][2];

    expect(auditContext.organizationId).toBeUndefined();
    expect(auditContext.userId).toBeUndefined();
  });

});
