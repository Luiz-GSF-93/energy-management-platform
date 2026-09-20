import { ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PERMISSIONS } from '../../../../common/constants/permissions';
import { PERMISSIONS_KEY } from '../../../../common/decorators/require-permission.decorator';
import { RoleGuard } from '../../../../common/guards/role.guard';
import { UsersController } from './users.controller';

describe('UsersController authorization contract', () => {
  const targetUserId = 'target-user';
  const actorUserId = 'actor-user';
  const organizationId = 'org-a';

  let usersService: {
    updateAffiliation: jest.Mock;
  };

  let controller: UsersController;
  let reflector: Reflector;
  let guard: RoleGuard;

  beforeEach(() => {
    usersService = {
      updateAffiliation: jest.fn().mockResolvedValue({
        userId: targetUserId,
        affiliationType: 'external',
      }),
    };

    controller = new UsersController(usersService as any);
    reflector = new Reflector();
    guard = new RoleGuard(reflector);
  });

  function executionContext(permissions?: string[]): any {
    const request = {
      tenantContext: {
        userId: actorUserId,
        organizationId,
        role: 'manager',
        roleId: 'role-a',
        permissions,
        email: 'actor@example.test',
      },
    };

    return {
      getHandler: () => UsersController.prototype.updateAffiliation,
      switchToHttp: () => ({
        getRequest: () => request,
      }),
    };
  }

  it('A — route declares ORGANIZATION_USERS_UPDATE', () => {
    const required = Reflect.getMetadata(
      PERMISSIONS_KEY,
      UsersController.prototype.updateAffiliation,
    );

    expect(required).toEqual([
      PERMISSIONS.ORGANIZATION_USERS_UPDATE,
    ]);
  });

  it('B — RoleGuard grants required organization user permission', async () => {
    const context = executionContext([
      PERMISSIONS.ORGANIZATION_USERS_UPDATE,
    ]);

    await expect(guard.canActivate(context)).resolves.toBe(true);
  });

  it('C — RoleGuard denies when required permission is absent', async () => {
    const context = executionContext([
      PERMISSIONS.ORGANIZATION_USERS_VIEW,
    ]);

    await expect(
      guard.canActivate(context),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('D — RoleGuard denies missing tenant context permissions', async () => {
    const context = executionContext(undefined);

    await expect(
      guard.canActivate(context),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('E — controller forwards target, affiliation and tenant audit context', async () => {
    const tenant: any = {
      userId: actorUserId,
      organizationId,
      role: 'manager',
      roleId: 'role-a',
      permissions: [PERMISSIONS.ORGANIZATION_USERS_UPDATE],
      email: 'actor@example.test',
    };

    const request: any = {
      ip: '127.0.0.1',
      get: jest.fn((header: string) =>
        header === 'user-agent' ? 'integration-test-agent' : undefined,
      ),
    };

    await controller.updateAffiliation(
      targetUserId,
      { affiliationType: 'external' },
      tenant,
      request,
    );

    expect(usersService.updateAffiliation).toHaveBeenCalledWith(
      targetUserId,
      'external',
      {
        actorUserId,
        organizationId,
        ipAddress: '127.0.0.1',
        userAgent: 'integration-test-agent',
      },
    );
  });
});
