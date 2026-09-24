import { ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PERMISSIONS } from '../../../../common/constants/permissions';
import { PERMISSIONS_KEY } from '../../../../common/decorators/require-permission.decorator';
import { RoleGuard } from '../../../../common/guards/role.guard';
import { UsersController } from './users.controller';

describe('UsersController.updateRole', () => {
  const actorUserId = 'actor-user';
  const targetUserId = 'target-user';
  const organizationId = 'org-a';
  const roleId = '22222222-2222-4222-8222-222222222222';

  const updateRole = jest.fn();

  const usersService: any = {
    findAll: jest.fn(),
    findOne: jest.fn(),
    updateAffiliation: jest.fn(),
    assertAssignable: jest.fn().mockResolvedValue(undefined),
    updateRole,
  };

  const controller = new UsersController(usersService);

  const executionContext = (
    handlerName: keyof UsersController,
    permissions: string[] | undefined,
  ): any => ({
    getHandler: () => UsersController.prototype[handlerName],
    switchToHttp: () => ({
      getRequest: () => ({
        tenantContext: permissions
          ? {
              userId: actorUserId,
              organizationId,
              role: 'manager',
              roleId: 'role-a',
              permissions,
              email: 'actor@example.test',
            }
          : undefined,
      }),
    }),
  });

  const reflector = new Reflector();

  const guard = new RoleGuard(reflector);

  beforeEach(() => {
    jest.clearAllMocks();
    updateRole.mockResolvedValue({
      userId: targetUserId,
      role: {
        id: roleId,
        name: 'operator',
      },
    });
  });

  it('A — role route declares ORGANIZATION_USERS_UPDATE', () => {
    expect(
      Reflect.getMetadata(
        PERMISSIONS_KEY,
        UsersController.prototype.updateRole,
      ),
    ).toEqual([PERMISSIONS.ORGANIZATION_USERS_UPDATE]);
  });

  it('B — RoleGuard grants role update with UPDATE permission', async () => {
    await expect(
      guard.canActivate(
        executionContext('updateRole', [
          PERMISSIONS.ORGANIZATION_USERS_UPDATE,
        ]),
      ),
    ).resolves.toBe(true);
  });

  it('C — RoleGuard denies role update without UPDATE permission', async () => {
    await expect(
      guard.canActivate(
        executionContext('updateRole', [
          PERMISSIONS.ORGANIZATION_USERS_VIEW,
        ]),
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('D — forwards target, role, tenant, actor and request origin', async () => {
    const tenant: any = {
      userId: actorUserId,
      organizationId,
      permissions: [PERMISSIONS.ORGANIZATION_USERS_UPDATE],
    };

    const request: any = {
      ip: '127.0.0.1',
      get: jest.fn((header: string) =>
        header === 'user-agent'
          ? 'f1.2.2b-controller-test'
          : undefined,
      ),
    };

    await controller.updateRole(
      targetUserId,
      { roleId },
      tenant,
      request,
    );

    expect(updateRole).toHaveBeenCalledTimes(1);
    expect(updateRole).toHaveBeenCalledWith(
      targetUserId,
      roleId,
      {
        actorUserId,
        organizationId,
        ipAddress: '127.0.0.1',
        userAgent: 'f1.2.2b-controller-test',
      },
    );
  });

  it('E — existing affiliation permission contract remains unchanged', () => {
    expect(
      Reflect.getMetadata(
        PERMISSIONS_KEY,
        UsersController.prototype.updateAffiliation,
      ),
    ).toEqual([PERMISSIONS.ORGANIZATION_USERS_UPDATE]);
  });
});
