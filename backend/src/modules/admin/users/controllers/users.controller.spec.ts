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
    findAll: jest.Mock;
    findOne: jest.Mock;
    updateAffiliation: jest.Mock;
  };

  let controller: UsersController;
  let reflector: Reflector;
  let guard: RoleGuard;

  beforeEach(() => {
    usersService = {
      findAll: jest.fn().mockResolvedValue([]),
      findOne: jest.fn().mockResolvedValue({
        userId: targetUserId,
      }),
      updateAffiliation: jest.fn().mockResolvedValue({
        userId: targetUserId,
        affiliationType: 'external',
      }),
    };

    controller = new UsersController(usersService as any);
    reflector = new Reflector();
    guard = new RoleGuard(reflector);
  });

  function executionContext(
    handler: keyof UsersController,
    permissions?: string[],
  ): any {
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
      getHandler: () => UsersController.prototype[handler],
      switchToHttp: () => ({
        getRequest: () => request,
      }),
    };
  }

  it('A — list declares ORGANIZATION_USERS_VIEW', () => {
    expect(
      Reflect.getMetadata(
        PERMISSIONS_KEY,
        UsersController.prototype.findAll,
      ),
    ).toEqual([PERMISSIONS.ORGANIZATION_USERS_VIEW]);
  });

  it('B — read one declares ORGANIZATION_USERS_VIEW', () => {
    expect(
      Reflect.getMetadata(
        PERMISSIONS_KEY,
        UsersController.prototype.findOne,
      ),
    ).toEqual([PERMISSIONS.ORGANIZATION_USERS_VIEW]);
  });

  it('C — RoleGuard grants VIEW for list', async () => {
    await expect(
      guard.canActivate(
        executionContext('findAll', [
          PERMISSIONS.ORGANIZATION_USERS_VIEW,
        ]),
      ),
    ).resolves.toBe(true);
  });

  it('D — RoleGuard denies list without VIEW', async () => {
    await expect(
      guard.canActivate(
        executionContext('findAll', [
          PERMISSIONS.ORGANIZATION_USERS_UPDATE,
        ]),
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('E — findAll forwards tenant organization', async () => {
    const tenant: any = {
      userId: actorUserId,
      organizationId,
      permissions: [PERMISSIONS.ORGANIZATION_USERS_VIEW],
    };

    await controller.findAll(tenant);

    expect(usersService.findAll).toHaveBeenCalledWith(organizationId);
  });

  it('F — findOne forwards target and tenant organization', async () => {
    const tenant: any = {
      userId: actorUserId,
      organizationId,
      permissions: [PERMISSIONS.ORGANIZATION_USERS_VIEW],
    };

    await controller.findOne(targetUserId, tenant);

    expect(usersService.findOne).toHaveBeenCalledWith(
      targetUserId,
      organizationId,
    );
  });

  it('G — affiliation route remains ORGANIZATION_USERS_UPDATE', () => {
    expect(
      Reflect.getMetadata(
        PERMISSIONS_KEY,
        UsersController.prototype.updateAffiliation,
      ),
    ).toEqual([PERMISSIONS.ORGANIZATION_USERS_UPDATE]);
  });

  it('H — RoleGuard still grants UPDATE for affiliation', async () => {
    await expect(
      guard.canActivate(
        executionContext('updateAffiliation', [
          PERMISSIONS.ORGANIZATION_USERS_UPDATE,
        ]),
      ),
    ).resolves.toBe(true);
  });

  it('I — RoleGuard denies missing permissions', async () => {
    await expect(
      guard.canActivate(executionContext('findOne', undefined)),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('J — affiliation forwards existing audit context unchanged', async () => {
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
        header === 'user-agent'
          ? 'integration-test-agent'
          : undefined,
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
