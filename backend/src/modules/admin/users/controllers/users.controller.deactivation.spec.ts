import { ForbiddenException, RequestMethod } from '@nestjs/common';
import { PATH_METADATA, METHOD_METADATA } from '@nestjs/common/constants';
import { Reflector } from '@nestjs/core';
import { PERMISSIONS } from '../../../../common/constants/permissions';
import { PERMISSIONS_KEY } from '../../../../common/decorators/require-permission.decorator';
import { RoleGuard } from '../../../../common/guards/role.guard';
import { UsersController } from './users.controller';

describe('UsersController.deactivate — F1.2.3b', () => {
  const userId = 'target-user';
  const actorUserId = 'actor-user';
  const organizationId = 'org-a';

  const makeHarness = () => {
    const usersService = {
      findAll: jest.fn(),
      findOne: jest.fn(),
      deactivate: jest.fn().mockResolvedValue({
        userId,
        membershipStatus: 'inactive',
      }),
      updateRole: jest.fn(),
      updateAffiliation: jest.fn(),
    };

    const controller = new UsersController(usersService as any);

    const tenant = {
      userId: actorUserId,
      organizationId,
      permissions: [PERMISSIONS.ORGANIZATION_USERS_DELETE],
    } as any;

    const request = {
      ip: '127.0.0.1',
      get: jest.fn((name: string) =>
        name === 'user-agent' ? 'f1.2.3b-controller' : undefined,
      ),
    } as any;

    return {
      usersService,
      controller,
      tenant,
      request,
    };
  };

  const getDeactivateMethod = () =>
    UsersController.prototype.deactivate;

  it('01 — exposes DELETE :userId route', () => {
    const method = getDeactivateMethod();

    expect(Reflect.getMetadata(PATH_METADATA, method)).toBe(':userId');
    expect(Reflect.getMetadata(METHOD_METADATA, method)).toBe(
      RequestMethod.DELETE,
    );
  });

  it('02 — requires ORGANIZATION_USERS_DELETE', () => {
    const reflector = new Reflector();

    const required = reflector.get<string[]>(
      PERMISSIONS_KEY,
      getDeactivateMethod(),
    );

    expect(required).toEqual([
      PERMISSIONS.ORGANIZATION_USERS_DELETE,
    ]);
  });

  it('03 — RoleGuard rejects a context without required delete permission', async () => {
    const reflector = new Reflector();

    const guard = new RoleGuard(reflector as any);

    const handler = getDeactivateMethod();

    const context = {
      getHandler: () => handler,
      getClass: () => UsersController,
      switchToHttp: () => ({
        getRequest: () => ({
          tenantContext: {
            userId: actorUserId,
            organizationId,
            permissions: [],
          },
        }),
      }),
    } as any;

    await expect(
      Promise.resolve(guard.canActivate(context)),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('04 — forwards target user ID to service', async () => {
    const h = makeHarness();

    await h.controller.deactivate(
      userId,
      h.tenant,
      h.request,
    );

    expect(h.usersService.deactivate).toHaveBeenCalledWith(
      userId,
      expect.any(Object),
    );
  });

  it('05 — organization comes from tenant context', async () => {
    const h = makeHarness();

    await h.controller.deactivate(
      userId,
      h.tenant,
      h.request,
    );

    expect(h.usersService.deactivate).toHaveBeenCalledWith(
      userId,
      expect.objectContaining({
        organizationId,
      }),
    );
  });

  it('06 — forwards actor user ID', async () => {
    const h = makeHarness();

    await h.controller.deactivate(
      userId,
      h.tenant,
      h.request,
    );

    expect(h.usersService.deactivate).toHaveBeenCalledWith(
      userId,
      expect.objectContaining({
        actorUserId,
      }),
    );
  });

  it('07 — forwards request IP', async () => {
    const h = makeHarness();

    await h.controller.deactivate(
      userId,
      h.tenant,
      h.request,
    );

    expect(h.usersService.deactivate).toHaveBeenCalledWith(
      userId,
      expect.objectContaining({
        ipAddress: '127.0.0.1',
      }),
    );
  });

  it('08 — forwards user-agent', async () => {
    const h = makeHarness();

    await h.controller.deactivate(
      userId,
      h.tenant,
      h.request,
    );

    expect(h.request.get).toHaveBeenCalledWith('user-agent');

    expect(h.usersService.deactivate).toHaveBeenCalledWith(
      userId,
      expect.objectContaining({
        userAgent: 'f1.2.3b-controller',
      }),
    );
  });

  it('09 — deactivation method has no body parameter metadata', () => {
    const parameterMetadata =
      Reflect.getMetadata(
        '__routeArguments__',
        UsersController,
        'deactivate',
      ) ?? {};

    const serialized = JSON.stringify(parameterMetadata);

    expect(serialized).not.toContain('"type":3');
  });

  it('10 — existing role route remains PATCH :userId/role', () => {
    const method = UsersController.prototype.updateRole;

    expect(Reflect.getMetadata(PATH_METADATA, method)).toBe(
      ':userId/role',
    );

    expect(Reflect.getMetadata(METHOD_METADATA, method)).toBe(
      RequestMethod.PATCH,
    );
  });

  it('11 — existing affiliation route remains PATCH :userId/affiliation', () => {
    const method = UsersController.prototype.updateAffiliation;

    expect(Reflect.getMetadata(PATH_METADATA, method)).toBe(
      ':userId/affiliation',
    );

    expect(Reflect.getMetadata(METHOD_METADATA, method)).toBe(
      RequestMethod.PATCH,
    );
  });
});
