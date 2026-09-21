import {
  BadRequestException,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { UsersService } from './users.service';

describe('UsersService.updateRole', () => {
  const actorUserId = 'actor-user';
  const targetUserId = 'target-user';
  const organizationId = 'org-a';
  const otherOrganizationId = 'org-b';
  const membershipId = 'membership-a';
  const beforeRoleId = '11111111-1111-4111-8111-111111111111';
  const requestedRoleId = '22222222-2222-4222-8222-222222222222';

  const auditContext = {
    actorUserId,
    organizationId,
    ipAddress: '127.0.0.1',
    userAgent: 'f1.2.2b-test',
  };

  const membership = {
    id: membershipId,
    user_id: targetUserId,
    organization_id: organizationId,
    role_id: beforeRoleId,
    status: 'active',
    roles: {
      id: beforeRoleId,
      name: 'manager',
      organization_id: organizationId,
      scope: 'organization',
    },
  };

  const destinationRole = {
    id: requestedRoleId,
    name: 'operator',
    organization_id: organizationId,
    scope: 'organization',
  };

  type Result = {
    data: any;
    error: any;
  };

  const createSelectQuery = (
    result: Result,
    eqCalls: Array<[string, any]>,
  ) => {
    const query: any = {};

    query.select = jest.fn(() => query);
    query.eq = jest.fn((field: string, value: any) => {
      eqCalls.push([field, value]);
      return query;
    });

    query.then = (
      resolve: (value: Result) => unknown,
      reject?: (reason: unknown) => unknown,
    ) => Promise.resolve(result).then(resolve, reject);

    return query;
  };

  const createUpdateQuery = (
    result: Result,
    eqCalls: Array<[string, any]>,
    updatePayloads: any[],
  ) => {
    const query: any = {};

    query.update = jest.fn((payload: any) => {
      updatePayloads.push(payload);
      return query;
    });

    query.eq = jest.fn((field: string, value: any) => {
      eqCalls.push([field, value]);
      return query;
    });

    query.select = jest.fn(() => Promise.resolve(result));

    return query;
  };

  const createHarness = (options: {
    membershipResult?: Result;
    roleResult?: Result;
    updateResult?: Result;
    rollbackResult?: Result;
    auditReject?: boolean;
  } = {}) => {
    const membershipEq: Array<[string, any]> = [];
    const roleEq: Array<[string, any]> = [];
    const updateEq: Array<[string, any]> = [];
    const rollbackEq: Array<[string, any]> = [];
    const updatePayloads: any[] = [];
    const rollbackPayloads: any[] = [];

    const membershipResult =
      options.membershipResult ?? {
        data: [membership],
        error: null,
      };

    const roleResult =
      options.roleResult ?? {
        data: [destinationRole],
        error: null,
      };

    const updateResult =
      options.updateResult ?? {
        data: [
          {
            id: membershipId,
            user_id: targetUserId,
            organization_id: organizationId,
            role_id: requestedRoleId,
            status: 'active',
          },
        ],
        error: null,
      };

    const rollbackResult =
      options.rollbackResult ?? {
        data: [
          {
            id: membershipId,
            role_id: beforeRoleId,
          },
        ],
        error: null,
      };

    const membershipQuery = createSelectQuery(
      membershipResult,
      membershipEq,
    );

    const roleQuery = createSelectQuery(
      roleResult,
      roleEq,
    );

    const updateQuery = createUpdateQuery(
      updateResult,
      updateEq,
      updatePayloads,
    );

    const rollbackQuery = createUpdateQuery(
      rollbackResult,
      rollbackEq,
      rollbackPayloads,
    );

    let organizationMembersCalls = 0;

    const from = jest.fn((table: string) => {
      if (table === 'roles') {
        return roleQuery;
      }

      if (table === 'organization_members') {
        organizationMembersCalls += 1;

        if (organizationMembersCalls === 1) {
          return membershipQuery;
        }

        if (organizationMembersCalls === 2) {
          return updateQuery;
        }

        if (organizationMembersCalls === 3) {
          return rollbackQuery;
        }
      }

      throw new Error(
        `Unexpected table/call: ${table}/${organizationMembersCalls}`,
      );
    });

    const logUserMembershipRoleChange = options.auditReject
      ? jest.fn().mockRejectedValue(new Error('audit failure'))
      : jest.fn().mockResolvedValue(undefined);

    const service = new UsersService(
      {
        getClient: () => ({
          from,
        }),
      } as any,
      {
        logUserMembershipRoleChange,
      } as any,
    );

    return {
      service,
      from,
      membershipEq,
      roleEq,
      updateEq,
      rollbackEq,
      updatePayloads,
      rollbackPayloads,
      logUserMembershipRoleChange,
    };
  };

  it('A — scopes target membership to user + tenant + active', async () => {
    const h = createHarness();

    await h.service.updateRole(
      targetUserId,
      requestedRoleId,
      auditContext,
    );

    expect(h.membershipEq).toEqual([
      ['user_id', targetUserId],
      ['organization_id', organizationId],
      ['status', 'active'],
    ]);
  });

  it('B — rejects missing active target membership', async () => {
    const h = createHarness({
      membershipResult: {
        data: [],
        error: null,
      },
    });

    await expect(
      h.service.updateRole(
        targetUserId,
        requestedRoleId,
        auditContext,
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('C — fails closed on duplicate active membership', async () => {
    const h = createHarness({
      membershipResult: {
        data: [membership, { ...membership }],
        error: null,
      },
    });

    await expect(
      h.service.updateRole(
        targetUserId,
        requestedRoleId,
        auditContext,
      ),
    ).rejects.toBeInstanceOf(InternalServerErrorException);
  });

  it('D — fails closed on membership query error', async () => {
    const h = createHarness({
      membershipResult: {
        data: null,
        error: { message: 'membership failure' },
      },
    });

    await expect(
      h.service.updateRole(
        targetUserId,
        requestedRoleId,
        auditContext,
      ),
    ).rejects.toBeInstanceOf(InternalServerErrorException);
  });

  it('E — validates current membership role integrity', async () => {
    const h = createHarness({
      membershipResult: {
        data: [
          {
            ...membership,
            roles: {
              ...membership.roles,
              id: 'wrong-role',
            },
          },
        ],
        error: null,
      },
    });

    await expect(
      h.service.updateRole(
        targetUserId,
        requestedRoleId,
        auditContext,
      ),
    ).rejects.toThrow(
      'Data integrity error: invalid current organization role',
    );
  });

  it('F — loads destination role only by requested role ID', async () => {
    const h = createHarness();

    await h.service.updateRole(
      targetUserId,
      requestedRoleId,
      auditContext,
    );

    expect(h.roleEq).toEqual([
      ['id', requestedRoleId],
    ]);
  });

  it('G — rejects missing destination role', async () => {
    const h = createHarness({
      roleResult: {
        data: [],
        error: null,
      },
    });

    await expect(
      h.service.updateRole(
        targetUserId,
        requestedRoleId,
        auditContext,
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('H — rejects destination role from another organization', async () => {
    const h = createHarness({
      roleResult: {
        data: [
          {
            ...destinationRole,
            organization_id: otherOrganizationId,
          },
        ],
        error: null,
      },
    });

    await expect(
      h.service.updateRole(
        targetUserId,
        requestedRoleId,
        auditContext,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('I — rejects global destination role', async () => {
    const h = createHarness({
      roleResult: {
        data: [
          {
            ...destinationRole,
            scope: 'global',
          },
        ],
        error: null,
      },
    });

    await expect(
      h.service.updateRole(
        targetUserId,
        requestedRoleId,
        auditContext,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('J — rejects malformed destination role', async () => {
    const h = createHarness({
      roleResult: {
        data: [
          {
            ...destinationRole,
            name: '',
          },
        ],
        error: null,
      },
    });

    await expect(
      h.service.updateRole(
        targetUserId,
        requestedRoleId,
        auditContext,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('K — idempotent same-role request performs no UPDATE or audit', async () => {
    const sameRoleMembership = {
      ...membership,
      role_id: requestedRoleId,
      roles: {
        ...destinationRole,
      },
    };

    const h = createHarness({
      membershipResult: {
        data: [sameRoleMembership],
        error: null,
      },
    });

    const result = await h.service.updateRole(
      targetUserId,
      requestedRoleId,
      auditContext,
    );

    expect(result).toEqual({
      userId: targetUserId,
      role: {
        id: requestedRoleId,
        name: destinationRole.name,
      },
    });

    expect(h.updatePayloads).toHaveLength(0);
    expect(h.logUserMembershipRoleChange).not.toHaveBeenCalled();
  });

  it('L — updates only membership role_id with full CAS', async () => {
    const h = createHarness();

    await h.service.updateRole(
      targetUserId,
      requestedRoleId,
      auditContext,
    );

    expect(h.updatePayloads).toEqual([
      {
        role_id: requestedRoleId,
      },
    ]);

    expect(h.updateEq).toEqual([
      ['user_id', targetUserId],
      ['organization_id', organizationId],
      ['status', 'active'],
      ['role_id', beforeRoleId],
    ]);
  });

  it('M — detects concurrent CAS conflict', async () => {
    const h = createHarness({
      updateResult: {
        data: [],
        error: null,
      },
    });

    await expect(
      h.service.updateRole(
        targetUserId,
        requestedRoleId,
        auditContext,
      ),
    ).rejects.toThrow(
      'Concurrent or invalid organization membership role update',
    );
  });

  it('N — fails closed on update query error', async () => {
    const h = createHarness({
      updateResult: {
        data: null,
        error: { message: 'update failure' },
      },
    });

    await expect(
      h.service.updateRole(
        targetUserId,
        requestedRoleId,
        auditContext,
      ),
    ).rejects.toThrow(
      'Failed to update organization membership role',
    );
  });

  it('O — audits complete successful role mutation context', async () => {
    const h = createHarness();

    const result = await h.service.updateRole(
      targetUserId,
      requestedRoleId,
      auditContext,
    );

    expect(h.logUserMembershipRoleChange).toHaveBeenCalledTimes(1);
    expect(h.logUserMembershipRoleChange).toHaveBeenCalledWith({
      actorUserId,
      organizationId,
      targetUserId,
      membershipId,
      beforeRoleId,
      afterRoleId: requestedRoleId,
      ipAddress: '127.0.0.1',
      userAgent: 'f1.2.2b-test',
    });

    expect(result).toEqual({
      userId: targetUserId,
      role: {
        id: requestedRoleId,
        name: destinationRole.name,
      },
    });
  });

  it('P — audit failure triggers guarded rollback against written role', async () => {
    const h = createHarness({
      auditReject: true,
    });

    await expect(
      h.service.updateRole(
        targetUserId,
        requestedRoleId,
        auditContext,
      ),
    ).rejects.toThrow(
      'Role audit failed. Membership role update was reverted.',
    );

    expect(h.rollbackPayloads).toEqual([
      {
        role_id: beforeRoleId,
      },
    ]);

    expect(h.rollbackEq).toEqual([
      ['user_id', targetUserId],
      ['organization_id', organizationId],
      ['status', 'active'],
      ['role_id', requestedRoleId],
    ]);
  });

  it('Q — audit failure with unconfirmed rollback fails critically', async () => {
    const h = createHarness({
      auditReject: true,
      rollbackResult: {
        data: [],
        error: null,
      },
    });

    await expect(
      h.service.updateRole(
        targetUserId,
        requestedRoleId,
        auditContext,
      ),
    ).rejects.toThrow(
      'CRITICAL: Role audit failed and rollback could not be confirmed',
    );
  });

  it('R — malformed updated row fails closed before audit', async () => {
    const h = createHarness({
      updateResult: {
        data: [
          {
            id: membershipId,
            user_id: targetUserId,
            organization_id: organizationId,
            role_id: requestedRoleId,
            status: 'inactive',
          },
        ],
        error: null,
      },
    });

    await expect(
      h.service.updateRole(
        targetUserId,
        requestedRoleId,
        auditContext,
      ),
    ).rejects.toThrow(
      'Data integrity error: invalid updated organization membership',
    );

    expect(h.logUserMembershipRoleChange).not.toHaveBeenCalled();
  });

  it('S — destination role query errors fail closed', async () => {
    const h = createHarness({
      roleResult: {
        data: null,
        error: { message: 'role query failure' },
      },
    });

    await expect(
      h.service.updateRole(
        targetUserId,
        requestedRoleId,
        auditContext,
      ),
    ).rejects.toThrow(
      'Failed to validate destination role',
    );
  });

  it('T — duplicate destination roles fail as integrity error', async () => {
    const h = createHarness({
      roleResult: {
        data: [destinationRole, { ...destinationRole }],
        error: null,
      },
    });

    await expect(
      h.service.updateRole(
        targetUserId,
        requestedRoleId,
        auditContext,
      ),
    ).rejects.toBeInstanceOf(InternalServerErrorException);
  });
});
