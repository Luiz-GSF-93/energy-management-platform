import {
  BadRequestException,
  ForbiddenException,
  ValidationPipe,
} from '@nestjs/common';
import { ROUTE_ARGS_METADATA } from '@nestjs/common/constants';
import { Reflector } from '@nestjs/core';
import { PERMISSIONS } from '../../../../common/constants/permissions';
import { PERMISSIONS_KEY } from '../../../../common/decorators/require-permission.decorator';
import { RoleGuard } from '../../../../common/guards/role.guard';
import { InviteUserDto } from '../dto/invite-user.dto';
import { UsersController } from './users.controller';

describe('UsersController.invite — F1.2.4c.2.2a', () => {
  const actorUserId = '11111111-1111-4111-8111-111111111111';
  const organizationId = '22222222-2222-4222-8222-222222222222';
  const roleId = '33333333-3333-4333-8333-333333333333';

  function createHarness() {
    const usersService = {
      assertAssignable: jest.fn().mockResolvedValue(undefined),
      invite: jest.fn().mockResolvedValue({
        userId: '44444444-4444-4444-8444-444444444444',
        membershipStatus: 'active',
      }),
    };

    const controller = new UsersController(usersService as any);

    return {
      usersService,
      controller,
    };
  }

  function executionContext(permissions?: string[]): any {
    return {
      getHandler: () => UsersController.prototype.invite,
      switchToHttp: () => ({
        getRequest: () => ({
          tenantContext: {
            userId: actorUserId,
            organizationId,
            role: 'manager',
            roleId,
            permissions,
            email: 'actor@example.test',
          },
        }),
      }),
    };
  }

  it('declares ORGANIZATION_USERS_INVITE', () => {
    expect(
      Reflect.getMetadata(
        PERMISSIONS_KEY,
        UsersController.prototype.invite,
      ),
    ).toEqual([PERMISSIONS.ORGANIZATION_USERS_INVITE]);
  });

  it('RoleGuard grants invite permission', async () => {
    const guard = new RoleGuard(new Reflector());

    await expect(
      guard.canActivate(
        executionContext([PERMISSIONS.ORGANIZATION_USERS_INVITE]),
      ),
    ).resolves.toBe(true);
  });

  it('RoleGuard denies invite without invite permission', async () => {
    const guard = new RoleGuard(new Reflector());

    await expect(
      guard.canActivate(
        executionContext([PERMISSIONS.ORGANIZATION_USERS_VIEW]),
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('forwards DTO and validated tenant/audit context only', async () => {
    const h = createHarness();

    const dto: InviteUserDto = {
      email: ' Invitee@Example.com ',
      name: 'Invitee User',
      roleId,
      affiliationType: 'external',
    };

    const tenant: any = {
      userId: actorUserId,
      organizationId,
      role: 'manager',
      roleId: 'manager-role',
      permissions: [PERMISSIONS.ORGANIZATION_USERS_INVITE],
      email: 'actor@example.test',
    };

    const request: any = {
      ip: '203.0.113.10',
      get: jest.fn((header: string) =>
        header === 'user-agent' ? 'invite-contract-test' : undefined,
      ),
    };

    await h.controller.invite(dto, tenant, request);

    expect(h.usersService.invite).toHaveBeenCalledTimes(1);
    expect(h.usersService.invite).toHaveBeenCalledWith(dto, {
      actorUserId,
      organizationId,
      ipAddress: '203.0.113.10',
      userAgent: 'invite-contract-test',
    });

    const forwarded = h.usersService.invite.mock.calls[0][0];

    expect(forwarded).not.toHaveProperty('organizationId');
    expect(forwarded).not.toHaveProperty('tenantId');
  });

  it('route has a local ValidationPipe', () => {
    const metadata =
      Reflect.getMetadata(
        '__pipes__',
        UsersController.prototype.invite,
      ) || [];

    expect(metadata.length).toBeGreaterThan(0);
    expect(
      metadata.some((pipe: unknown) => pipe instanceof ValidationPipe),
    ).toBe(true);
  });

  it('local validation rejects invalid invite payload', async () => {
    const pipe = new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
    });

    await expect(
      pipe.transform(
        {
          email: 'not-an-email',
          name: 'x',
          roleId: 'not-a-uuid',
          affiliationType: 'invalid',
        },
        {
          type: 'body',
          metatype: InviteUserDto,
        },
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('local validation rejects tenant injection fields', async () => {
    const pipe = new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
    });

    await expect(
      pipe.transform(
        {
          email: 'invitee@example.com',
          name: 'Invitee User',
          roleId,
          affiliationType: 'internal',
          organizationId,
        },
        {
          type: 'body',
          metatype: InviteUserDto,
        },
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
