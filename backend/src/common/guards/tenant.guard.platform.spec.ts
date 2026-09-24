import {
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { TenantGuard } from './tenant.guard';
import { PLATFORM_SCOPE_KEY } from '../decorators/platform-scope.decorator';
import { RECOVERY_ENDPOINT_KEY } from '../decorators/recovery-endpoint.decorator';

describe('TenantGuard — Phase 5.7 platform scope', () => {
  const userId = '11111111-1111-4111-8111-111111111111';
  const organizationId = 'org-a';
  const globalRoleId = 'global-role';
  const organizationRoleId = 'organization-role';

  const makeRequest = () => ({
    headers: {
      authorization: 'Bearer header.payload.signature',
    },
    path: '/test',
    method: 'GET',
  });

  const makeExecutionContext = (request: any) => {
    const handler = function handler() {};
    const controller = class TestController {};

    return {
      getHandler: () => handler,
      getClass: () => controller,
      switchToHttp: () => ({
        getRequest: () => request,
      }),
    } as any;
  };

  const makeReflector = ({
    platform = false,
    recovery = false,
  }: {
    platform?: boolean;
    recovery?: boolean;
  }) => {
    return {
      getAllAndOverride: jest.fn((key: string) => {
        if (key === PLATFORM_SCOPE_KEY) {
          return platform;
        }

        return false;
      }),
      get: jest.fn((key: string) => {
        if (key === RECOVERY_ENDPOINT_KEY) {
          return recovery;
        }

        return undefined;
      }),
    } as unknown as Reflector;
  };

  const makeSupabase = ({
    globalAssignments = [],
    globalAssignmentError = null,
    organizationRoleScope = 'organization',
  }: {
    globalAssignments?: any[];
    globalAssignmentError?: any;
    organizationRoleScope?: string;
  } = {}) => {
    const calls: string[] = [];

    const profileQuery = {
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      single: jest.fn().mockResolvedValue({
        data: { organization_id: organizationId },
        error: null,
      }),
    };

    const organizationQuery = {
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      single: jest.fn().mockResolvedValue({
        data: {
          id: organizationId,
          deleted_at: null,
        },
        error: null,
      }),
    };

    const membershipQuery = {
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      single: jest.fn().mockResolvedValue({
        data: {
          id: 'membership-1',
          user_id: userId,
          organization_id: organizationId,
          role_id: organizationRoleId,
          status: 'active',
          roles: {
            id: organizationRoleId,
            name: 'manager',
            permissions: ['organization.read'],
            organization_id: organizationId,
            scope: organizationRoleScope,
          },
        },
        error: null,
      }),
    };

    const userRolesQuery = {
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockResolvedValue({
        data: globalAssignments,
        error: globalAssignmentError,
      }),
    };

    const client = {
      auth: {
        getUser: jest.fn().mockResolvedValue({
          data: {
            user: {
              id: userId,
              email: 'platform@example.test',
            },
          },
          error: null,
        }),
      },
      from: jest.fn((table: string) => {
        calls.push(table);

        if (table === 'user_profiles') {
          return profileQuery;
        }

        if (table === 'user_roles') {
          return userRolesQuery;
        }

        if (table === 'organizations') {
          return organizationQuery;
        }

        if (table === 'organization_members') {
          return membershipQuery;
        }

        throw new Error(`Unexpected table: ${table}`);
      }),
    };

    return {
      service: {
        getClient: () => client,
      } as any,
      client,
      calls,
    };
  };

  const validGlobalAssignment = () => ({
    user_id: userId,
    role_id: globalRoleId,
    roles: {
      id: globalRoleId,
      name: 'admin_platform',
      permissions: ['platform.organizations.view'],
      scope: 'global',
    },
  });

  it('A — resolves explicit platform endpoint from one valid global assignment', async () => {
    const request: any = makeRequest();
    const supabase = makeSupabase({
      globalAssignments: [validGlobalAssignment()],
    });

    const guard = new TenantGuard(
      makeReflector({ platform: true }),
      supabase.service,
    );

    await expect(
      guard.canActivate(makeExecutionContext(request)),
    ).resolves.toBe(true);

    expect(request.accessContext).toEqual(
      expect.objectContaining({
        scope: 'global',
        userId,
        role: 'admin_platform',
        roleId: globalRoleId,
        permissions: ['platform.organizations.view'],
      }),
    );

    expect(request.accessContext.organizationId).toBeUndefined();
    expect(request.tenantContext).toBeUndefined();
    expect(supabase.calls).toContain('user_roles');
    expect(supabase.calls).not.toContain('organization_members');
  });

  it('B — platform endpoint does not require organization membership', async () => {
    const request: any = makeRequest();
    const supabase = makeSupabase({
      globalAssignments: [validGlobalAssignment()],
    });

    const guard = new TenantGuard(
      makeReflector({ platform: true }),
      supabase.service,
    );

    await guard.canActivate(makeExecutionContext(request));

    expect(supabase.calls).not.toContain('organization_members');
    expect(supabase.calls).not.toContain('organizations');
  });

  it('C — denies platform endpoint when global assignment is missing', async () => {
    const request: any = makeRequest();
    const supabase = makeSupabase({
      globalAssignments: [],
    });

    const guard = new TenantGuard(
      makeReflector({ platform: true }),
      supabase.service,
    );

    await expect(
      guard.canActivate(makeExecutionContext(request)),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('D — organization-scoped role cannot satisfy platform scope', async () => {
    const request: any = makeRequest();

    const assignment = validGlobalAssignment();
    assignment.roles.scope = 'organization';

    const supabase = makeSupabase({
      globalAssignments: [assignment],
    });

    const guard = new TenantGuard(
      makeReflector({ platform: true }),
      supabase.service,
    );

    await expect(
      guard.canActivate(makeExecutionContext(request)),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('E — denies multiple valid global assignments', async () => {
    const request: any = makeRequest();

    const first = validGlobalAssignment();
    const second = {
      ...validGlobalAssignment(),
      role_id: 'global-role-2',
      roles: {
        ...validGlobalAssignment().roles,
        id: 'global-role-2',
      },
    };

    const supabase = makeSupabase({
      globalAssignments: [first, second],
    });

    const guard = new TenantGuard(
      makeReflector({ platform: true }),
      supabase.service,
    );

    await expect(
      guard.canActivate(makeExecutionContext(request)),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('F — denies malformed global role permissions', async () => {
    const request: any = makeRequest();

    const assignment: any = validGlobalAssignment();
    assignment.roles.permissions = {};

    const supabase = makeSupabase({
      globalAssignments: [assignment],
    });

    const guard = new TenantGuard(
      makeReflector({ platform: true }),
      supabase.service,
    );

    await expect(
      guard.canActivate(makeExecutionContext(request)),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('G — fails closed when global assignment query fails', async () => {
    const request: any = makeRequest();

    const supabase = makeSupabase({
      globalAssignmentError: {
        message: 'query failed',
      },
    });

    const guard = new TenantGuard(
      makeReflector({ platform: true }),
      supabase.service,
    );

    await expect(
      guard.canActivate(makeExecutionContext(request)),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('H — normal organization endpoint never queries user_roles', async () => {
    const request: any = makeRequest();
    const supabase = makeSupabase();

    const guard = new TenantGuard(
      makeReflector({ platform: false }),
      supabase.service,
    );

    await expect(
      guard.canActivate(makeExecutionContext(request)),
    ).resolves.toBe(true);

    expect(supabase.calls).not.toContain('user_roles');
    expect(supabase.calls).toContain('organization_members');

    expect(request.tenantContext).toEqual(
      expect.objectContaining({
        scope: 'organization',
        organizationId,
        roleId: organizationRoleId,
      }),
    );

    expect(request.accessContext).toBe(request.tenantContext);
  });

  it('I — organization flow rejects a non-organization membership role', async () => {
    const request: any = makeRequest();

    const supabase = makeSupabase({
      organizationRoleScope: 'global',
    });

    const guard = new TenantGuard(
      makeReflector({ platform: false }),
      supabase.service,
    );

    await expect(
      guard.canActivate(makeExecutionContext(request)),
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(supabase.calls).not.toContain('user_roles');
  });

  it('J — recovery remains JWT plus profile only and never queries role authorities', async () => {
    const request: any = makeRequest();
    const supabase = makeSupabase();

    const guard = new TenantGuard(
      makeReflector({
        platform: true,
        recovery: true,
      }),
      supabase.service,
    );

    await expect(
      guard.canActivate(makeExecutionContext(request)),
    ).resolves.toBe(true);

    expect(request.authenticatedUser).toEqual(
      expect.objectContaining({
        userId,
      }),
    );

    expect(request.accessContext).toBeUndefined();
    expect(request.tenantContext).toBeUndefined();

    expect(supabase.calls).toEqual(['user_profiles']);
    expect(supabase.calls).not.toContain('user_roles');
    expect(supabase.calls).not.toContain('organization_members');
  });

  it('K — invalid JWT remains unauthorized before platform resolution', async () => {
    const request: any = makeRequest();
    const supabase = makeSupabase({
      globalAssignments: [validGlobalAssignment()],
    });

    supabase.client.auth.getUser.mockResolvedValueOnce({
      data: { user: null },
      error: { message: 'invalid token' },
    });

    const guard = new TenantGuard(
      makeReflector({ platform: true }),
      supabase.service,
    );

    await expect(
      guard.canActivate(makeExecutionContext(request)),
    ).rejects.toBeInstanceOf(UnauthorizedException);

    expect(supabase.calls).not.toContain('user_roles');
  });
  it('resolves an explicit platform operation through server authority, not the profile pointer', async () => {
    const request: any = makeRequest();
    request.headers['x-platform-organization-session']='33333333-3333-4333-8333-333333333333';
    const supabase=makeSupabase();
    (supabase.client as any).rpc=jest.fn().mockResolvedValue({data:[{organization_id:'explicit-org',organization_name:'Explicit',role_id:'admin-org',permissions:['documents.view']}],error:null});
    const guard=new TenantGuard(makeReflector({}),supabase.service);
    await expect(guard.canActivate(makeExecutionContext(request))).resolves.toBe(true);
    expect(request.tenantContext).toMatchObject({userId,organizationId:'explicit-org',accessMode:'platform_operation'});
    expect(supabase.calls).not.toContain('organization_members');
  });
  it('never falls back to a normal membership when the explicit session is rejected',async()=>{
    const request:any=makeRequest();request.headers['x-platform-organization-session']='33333333-3333-4333-8333-333333333333';
    const supabase=makeSupabase();(supabase.client as any).rpc=jest.fn().mockResolvedValue({data:[],error:null});
    const guard=new TenantGuard(makeReflector({}),supabase.service);
    await expect(guard.canActivate(makeExecutionContext(request))).rejects.toBeInstanceOf(ForbiddenException);
    expect(request.tenantContext).toBeUndefined();
  });

});
