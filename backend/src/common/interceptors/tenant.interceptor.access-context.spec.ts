import { BadRequestException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { of, lastValueFrom } from 'rxjs';
import { TenantInterceptor } from './tenant.interceptor';
import { RECOVERY_ENDPOINT_KEY } from '../decorators/recovery-endpoint.decorator';

describe('TenantInterceptor — AccessContext compatibility', () => {
  const makeReflector = (recovery = false) =>
    ({
      get: jest.fn((key: string) => {
        if (key === RECOVERY_ENDPOINT_KEY) {
          return recovery;
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

  const next = () => ({
    handle: jest.fn(() => of({ ok: true })),
  });

  it('A — global context does not inject organization_id', async () => {
    const interceptor = new TenantInterceptor(makeReflector());

    const request: any = {
      method: 'POST',
      path: '/platform-test',
      body: {
        name: 'Example',
      },
      accessContext: {
        scope: 'global',
        userId: 'platform-user',
        role: 'admin_platform',
        roleId: 'global-role',
        permissions: ['platform.organizations.create'],
        email: 'platform@example.test',
      },
    };

    await lastValueFrom(
      interceptor.intercept(makeContext(request), next() as any),
    );

    expect(request.body).toEqual({
      name: 'Example',
    });

    expect(request.body.organization_id).toBeUndefined();
  });

  it('B — global context preserves explicit organization_id without tenant comparison', async () => {
    const interceptor = new TenantInterceptor(makeReflector());

    const request: any = {
      method: 'PATCH',
      path: '/platform-test',
      body: {
        organization_id: 'target-org',
      },
      accessContext: {
        scope: 'global',
        userId: 'platform-user',
        role: 'admin_platform',
        roleId: 'global-role',
        permissions: ['platform.organizations.update'],
        email: 'platform@example.test',
      },
    };

    await expect(
      lastValueFrom(
        interceptor.intercept(makeContext(request), next() as any),
      ),
    ).resolves.toEqual({ ok: true });

    expect(request.body.organization_id).toBe('target-org');
  });

  it('C — organization context does not contaminate the DTO with organization_id', async () => {
    const interceptor = new TenantInterceptor(makeReflector());

    const request: any = {
      method: 'POST',
      path: '/organization-test',
      body: {
        name: 'Example',
      },
      accessContext: {
        scope: 'organization',
        userId: 'manager-user',
        organizationId: 'org-a',
        role: 'manager',
        roleId: 'manager-role',
        permissions: [],
        email: 'manager@example.test',
      },
      tenantContext: {
        scope: 'organization',
        userId: 'manager-user',
        organizationId: 'org-a',
        role: 'manager',
        roleId: 'manager-role',
        permissions: [],
        email: 'manager@example.test',
      },
    };

    await lastValueFrom(
      interceptor.intercept(makeContext(request), next() as any),
    );

    expect(request.body).toEqual({ name: 'Example' });
  });

  it('D — organization context still rejects cross-organization body', () => {
    const interceptor = new TenantInterceptor(makeReflector());

    const request: any = {
      method: 'PATCH',
      path: '/organization-test',
      body: {
        organization_id: 'org-b',
      },
      accessContext: {
        scope: 'organization',
        userId: 'manager-user',
        organizationId: 'org-a',
        role: 'manager',
        roleId: 'manager-role',
        permissions: [],
        email: 'manager@example.test',
      },
      tenantContext: {
        scope: 'organization',
        userId: 'manager-user',
        organizationId: 'org-a',
        role: 'manager',
        roleId: 'manager-role',
        permissions: [],
        email: 'manager@example.test',
      },
    };

    expect(() =>
      interceptor.intercept(
        makeContext(request),
        next() as any,
      ),
    ).toThrow(BadRequestException);
  });

  it('E — legacy tenantContext remains available without mutating the DTO', async () => {
    const interceptor = new TenantInterceptor(makeReflector());

    const request: any = {
      method: 'POST',
      path: '/legacy-test',
      body: {},
      tenantContext: {
        userId: 'manager-user',
        organizationId: 'org-a',
        role: 'manager',
        roleId: 'manager-role',
        permissions: [],
        email: 'manager@example.test',
      },
    };

    await lastValueFrom(
      interceptor.intercept(makeContext(request), next() as any),
    );

    expect(request.body).toEqual({});
    expect(request.tenantContext.organizationId).toBe('org-a');
  });

  it('F — recovery behavior remains unchanged', async () => {
    const interceptor = new TenantInterceptor(makeReflector(true));

    const request: any = {
      method: 'POST',
      path: '/recovery-test',
      body: {},
    };

    await lastValueFrom(
      interceptor.intercept(makeContext(request), next() as any),
    );

    expect(request.body.organization_id).toBeUndefined();
  });
});
