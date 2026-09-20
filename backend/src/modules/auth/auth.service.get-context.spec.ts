import {
  ForbiddenException,
  InternalServerErrorException,
} from '@nestjs/common';
import { AuthService } from './auth.service';
import { TenantContext } from '../../common/interfaces/tenant-context.interface';

describe('AuthService.getContext — Phase 5.5c', () => {
  const tenant: TenantContext = {
    userId: 'user-1',
    organizationId: 'org-a',
    role: 'manager',
    roleId: 'role-a',
    permissions: [],
    email: 'user@example.test',
  };

  const activeMembership = (
    organizationId: string,
    roleId: string,
    roleName: string,
    permissions: string[] = [],
  ) => ({
    user_id: tenant.userId,
    organization_id: organizationId,
    role_id: roleId,
    status: 'active',
    roles: {
      id: roleId,
      name: roleName,
      organization_id: organizationId,
      permissions,
    },
    organizations: {
      id: organizationId,
      name: `Organization ${organizationId}`,
      deleted_at: null as string | null,
    },
  });

  function createService(
    memberships: any[] | null,
    queryError: any = null,
  ) {
    const eqStatus = jest.fn().mockResolvedValue({
      data: memberships,
      error: queryError,
    });

    const eqUser = jest.fn().mockReturnValue({
      eq: eqStatus,
    });

    const select = jest.fn().mockReturnValue({
      eq: eqUser,
    });

    const from = jest.fn().mockReturnValue({
      select,
    });

    const supabaseClient = {
      from,
    };

    const supabaseService = {
      getClient: jest.fn().mockReturnValue(supabaseClient),
    };

    const configService = {};
    const auditService = {};

    const service = new AuthService(
      supabaseService as any,
      configService as any,
      auditService as any,
    );

    return {
      service,
      from,
      select,
      eqUser,
      eqStatus,
    };
  }

  it('A — returns the preserved contract for a valid active membership', async () => {
    const membership = activeMembership(
      'org-a',
      'role-a',
      'manager',
      ['contracts.read'],
    );

    const { service, from, eqUser, eqStatus } = createService([membership]);

    const result = await service.getContext(tenant);

    expect(from).toHaveBeenCalledTimes(1);
    expect(from).toHaveBeenCalledWith('organization_members');

    expect(eqUser).toHaveBeenCalledWith('user_id', tenant.userId);
    expect(eqStatus).toHaveBeenCalledWith('status', 'active');

    expect(result).toEqual({
      user: {
        id: tenant.userId,
        email: tenant.email,
      },
      organizations: [
        {
          id: 'org-a',
          role: 'manager',
          role_id: 'role-a',
        },
      ],
      currentOrganization: {
        id: 'org-a',
        role: 'manager',
        permissions: ['contracts.read'],
      },
    });
  });

  it('B — returns multiple valid memberships but selects current organization strictly from tenant.organizationId', async () => {
    const orgB = activeMembership(
      'org-b',
      'role-b',
      'operator',
      ['invoice.read'],
    );

    const orgA = activeMembership(
      'org-a',
      'role-a',
      'manager',
      ['contracts.read'],
    );

    const { service } = createService([orgB, orgA]);

    const result = await service.getContext(tenant);

    expect(result.organizations).toEqual([
      {
        id: 'org-b',
        role: 'operator',
        role_id: 'role-b',
      },
      {
        id: 'org-a',
        role: 'manager',
        role_id: 'role-a',
      },
    ]);

    expect(result.currentOrganization).toEqual({
      id: 'org-a',
      role: 'manager',
      permissions: ['contracts.read'],
    });
  });

  it('C — excludes an inactive membership', async () => {
    const inactive = activeMembership(
      'org-a',
      'role-a',
      'manager',
      ['contracts.read'],
    );

    inactive.status = 'inactive';

    const { service, eqStatus } = createService([]);

    await expect(service.getContext(tenant)).rejects.toBeInstanceOf(
      ForbiddenException,
    );

    expect(eqStatus).toHaveBeenCalledWith('status', 'active');

    // Supabase is expected to enforce status=active before the service
    // receives memberships, so the inactive fixture is intentionally
    // absent from the mocked query result.
    expect(inactive.status).toBe('inactive');
  });

  it('D — excludes a membership whose organization is soft-deleted', async () => {
    const deleted = activeMembership(
      'org-a',
      'role-a',
      'manager',
      ['contracts.read'],
    );

    deleted.organizations.deleted_at = '2026-09-20T00:00:00.000Z';

    const { service } = createService([deleted]);

    await expect(service.getContext(tenant)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('E — excludes a role belonging to another organization', async () => {
    const mismatched = activeMembership(
      'org-a',
      'role-a',
      'manager',
      ['contracts.read'],
    );

    mismatched.roles.organization_id = 'org-b';

    const { service } = createService([mismatched]);

    await expect(service.getContext(tenant)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('F — fails closed when tenant.organizationId cannot be resolved', async () => {
    const otherOrganization = activeMembership(
      'org-b',
      'role-b',
      'operator',
      ['invoice.read'],
    );

    const { service } = createService([otherOrganization]);

    await expect(service.getContext(tenant)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('G — converts membership query failure to InternalServerErrorException', async () => {
    const { service } = createService(null, {
      code: 'TEST_DB_ERROR',
      message: 'synthetic test failure',
    });

    await expect(service.getContext(tenant)).rejects.toBeInstanceOf(
      InternalServerErrorException,
    );
  });

  it('H — does not expose permissions for non-current organizations', async () => {
    const orgA = activeMembership(
      'org-a',
      'role-a',
      'manager',
      ['current.secret.permission'],
    );

    const orgB = activeMembership(
      'org-b',
      'role-b',
      'operator',
      ['noncurrent.secret.permission'],
    );

    const { service } = createService([orgA, orgB]);

    const result = await service.getContext(tenant);

    expect(result.organizations).toEqual([
      {
        id: 'org-a',
        role: 'manager',
        role_id: 'role-a',
      },
      {
        id: 'org-b',
        role: 'operator',
        role_id: 'role-b',
      },
    ]);

    expect(
      result.organizations.some(
        (organization: Record<string, unknown>) =>
          Object.prototype.hasOwnProperty.call(
            organization,
            'permissions',
          ),
      ),
    ).toBe(false);

    expect(result.currentOrganization.permissions).toEqual([
      'current.secret.permission',
    ]);

    expect(
      JSON.stringify(result.currentOrganization),
    ).not.toContain('noncurrent.secret.permission');
  });

  it('I — never queries legacy user_roles', async () => {
    const membership = activeMembership(
      'org-a',
      'role-a',
      'manager',
    );

    const { service, from } = createService([membership]);

    await service.getContext(tenant);

    expect(from).toHaveBeenCalledTimes(1);
    expect(from).toHaveBeenCalledWith('organization_members');
    expect(from).not.toHaveBeenCalledWith('user_roles');
  });

  it('J — excludes membership when membership.role_id does not match role.id', async () => {
    const mismatched = activeMembership(
      'org-a',
      'role-a',
      'manager',
      ['contracts.read'],
    );

    mismatched.role_id = 'different-role-id';

    const { service } = createService([mismatched]);

    await expect(service.getContext(tenant)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });
});
