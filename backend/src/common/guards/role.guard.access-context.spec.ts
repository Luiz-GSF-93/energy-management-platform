import { ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RoleGuard } from './role.guard';
import { PERMISSIONS_KEY } from '../decorators/require-permission.decorator';
import { RECOVERY_ENDPOINT_KEY } from '../decorators/recovery-endpoint.decorator';

describe('RoleGuard — AccessContext compatibility', () => {
  const permission = 'platform.organizations.view';

  const makeReflector = ({
    required = [permission],
    recovery = false,
  }: {
    required?: string[];
    recovery?: boolean;
  } = {}) =>
    ({
      get: jest.fn((key: string) => {
        if (key === RECOVERY_ENDPOINT_KEY) {
          return recovery;
        }

        if (key === PERMISSIONS_KEY) {
          return required;
        }

        return undefined;
      }),
    }) as unknown as Reflector;

  const makeContext = (request: any) =>
    ({
      getHandler: () => function handler() {},
      switchToHttp: () => ({
        getRequest: () => request,
      }),
    }) as any;

  it('A — grants permission from global accessContext', async () => {
    const guard = new RoleGuard(makeReflector());

    const request = {
      accessContext: {
        scope: 'global',
        userId: 'platform-user',
        role: 'admin_platform',
        roleId: 'global-role',
        permissions: [permission],
        email: 'platform@example.test',
      },
    };

    await expect(
      guard.canActivate(makeContext(request)),
    ).resolves.toBe(true);
  });

  it('B — denies global accessContext without required permission', async () => {
    const guard = new RoleGuard(makeReflector());

    const request = {
      accessContext: {
        scope: 'global',
        userId: 'platform-user',
        role: 'admin_platform',
        roleId: 'global-role',
        permissions: [],
        email: 'platform@example.test',
      },
    };

    await expect(
      guard.canActivate(makeContext(request)),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('C — preserves legacy tenantContext permission flow', async () => {
    const guard = new RoleGuard(makeReflector());

    const request = {
      tenantContext: {
        userId: 'manager-user',
        organizationId: 'org-a',
        role: 'manager',
        roleId: 'manager-role',
        permissions: [permission],
        email: 'manager@example.test',
      },
    };

    await expect(
      guard.canActivate(makeContext(request)),
    ).resolves.toBe(true);
  });

  it('D — accessContext is authoritative when both contexts exist', async () => {
    const guard = new RoleGuard(makeReflector());

    const request = {
      accessContext: {
        scope: 'global',
        userId: 'platform-user',
        role: 'admin_platform',
        roleId: 'global-role',
        permissions: [],
        email: 'platform@example.test',
      },
      tenantContext: {
        userId: 'manager-user',
        organizationId: 'org-a',
        role: 'manager',
        roleId: 'manager-role',
        permissions: [permission],
        email: 'manager@example.test',
      },
    };

    await expect(
      guard.canActivate(makeContext(request)),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('E — malformed permissions fail closed', async () => {
    const guard = new RoleGuard(makeReflector());

    const request = {
      accessContext: {
        scope: 'global',
        permissions: {},
      },
    };

    await expect(
      guard.canActivate(makeContext(request)),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('F — recovery behavior remains unchanged', async () => {
    const guard = new RoleGuard(
      makeReflector({
        recovery: true,
      }),
    );

    await expect(
      guard.canActivate(makeContext({})),
    ).resolves.toBe(true);
  });
});
