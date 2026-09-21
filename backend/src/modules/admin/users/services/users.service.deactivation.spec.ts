import {
  BadRequestException,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { UsersService } from './users.service';

describe('UsersService.deactivate — F1.2.3b', () => {
  const targetUserId = 'target-user';
  const actorUserId = 'actor-user';
  const organizationId = 'org-a';
  const membershipId = 'membership-a';

  const activeMembership = {
    id: membershipId,
    user_id: targetUserId,
    organization_id: organizationId,
    role_id: 'role-a',
    status: 'active',
  };

  const inactiveMembership = {
    id: membershipId,
    user_id: targetUserId,
    organization_id: organizationId,
    status: 'inactive',
  };

  const restoredMembership = {
    id: membershipId,
    user_id: targetUserId,
    organization_id: organizationId,
    status: 'active',
  };

  type QueryResult = {
    data: any;
    error: any;
  };

  const makeSelectQuery = (result: QueryResult) => {
    const query: any = {
      select: jest.fn(() => query),
      eq: jest.fn(() => query),
      then: (
        resolve: (value: QueryResult) => unknown,
        reject?: (reason: unknown) => unknown,
      ) => Promise.resolve(result).then(resolve, reject),
    };

    return query;
  };

  const makeUpdateQuery = (result: QueryResult) => {
    const query: any = {
      update: jest.fn(() => query),
      eq: jest.fn(() => query),
      select: jest.fn(() => query),
      then: (
        resolve: (value: QueryResult) => unknown,
        reject?: (reason: unknown) => unknown,
      ) => Promise.resolve(result).then(resolve, reject),
    };

    return query;
  };

  const makeHarness = (options?: {
    membershipResult?: QueryResult;
    updateResult?: QueryResult;
    rollbackResult?: QueryResult;
    auditError?: Error | null;
  }) => {
    const membershipQuery = makeSelectQuery(
      options?.membershipResult ?? {
        data: [activeMembership],
        error: null,
      },
    );

    const updateQuery = makeUpdateQuery(
      options?.updateResult ?? {
        data: [inactiveMembership],
        error: null,
      },
    );

    const rollbackQuery = makeUpdateQuery(
      options?.rollbackResult ?? {
        data: [restoredMembership],
        error: null,
      },
    );

    let organizationMembersCall = 0;

    const from = jest.fn((table: string) => {
      if (table !== 'organization_members') {
        throw new Error(`Unexpected table: ${table}`);
      }

      organizationMembersCall += 1;

      if (organizationMembersCall === 1) {
        return membershipQuery;
      }

      if (organizationMembersCall === 2) {
        return updateQuery;
      }

      if (organizationMembersCall === 3) {
        return rollbackQuery;
      }

      throw new Error('Unexpected organization_members query');
    });

    const client = { from };

    const supabaseService = {
      getClient: jest.fn(() => client),
    };

    const logUserMembershipDeactivation =
      options?.auditError
        ? jest.fn().mockRejectedValue(options.auditError)
        : jest.fn().mockResolvedValue(undefined);

    const auditService = {
      logUserMembershipDeactivation,
    };

    const service = new UsersService(
      supabaseService as any,
      auditService as any,
    );

    return {
      service,
      supabaseService,
      auditService,
      from,
      membershipQuery,
      updateQuery,
      rollbackQuery,
      logUserMembershipDeactivation,
    };
  };

  const auditContext = {
    actorUserId,
    organizationId,
    ipAddress: '127.0.0.1',
    userAgent: 'f1.2.3b-test',
  };

  it('01 — scopes target lookup by user, current organization, and active status', async () => {
    const h = makeHarness();

    await h.service.deactivate(targetUserId, auditContext);

    expect(h.membershipQuery.eq).toHaveBeenCalledWith(
      'user_id',
      targetUserId,
    );
    expect(h.membershipQuery.eq).toHaveBeenCalledWith(
      'organization_id',
      organizationId,
    );
    expect(h.membershipQuery.eq).toHaveBeenCalledWith(
      'status',
      'active',
    );
  });

  it('02 — fails closed when active membership is missing', async () => {
    const h = makeHarness({
      membershipResult: { data: [], error: null },
    });

    await expect(
      h.service.deactivate(targetUserId, auditContext),
    ).rejects.toBeInstanceOf(NotFoundException);

    expect(h.logUserMembershipDeactivation).not.toHaveBeenCalled();
  });

  it('03 — rejects duplicate active memberships', async () => {
    const h = makeHarness({
      membershipResult: {
        data: [activeMembership, { ...activeMembership, id: 'membership-b' }],
        error: null,
      },
    });

    await expect(
      h.service.deactivate(targetUserId, auditContext),
    ).rejects.toBeInstanceOf(InternalServerErrorException);
  });

  it('04 — fails closed on membership query error', async () => {
    const h = makeHarness({
      membershipResult: {
        data: null,
        error: { message: 'membership read failed' },
      },
    });

    await expect(
      h.service.deactivate(targetUserId, auditContext),
    ).rejects.toBeInstanceOf(InternalServerErrorException);
  });

  it('05 — rejects malformed membership identity', async () => {
    const h = makeHarness({
      membershipResult: {
        data: [{ ...activeMembership, id: '' }],
        error: null,
      },
    });

    await expect(
      h.service.deactivate(targetUserId, auditContext),
    ).rejects.toBeInstanceOf(InternalServerErrorException);
  });

  it('06 — blocks self-deactivation before any database access', async () => {
    const h = makeHarness();

    await expect(
      h.service.deactivate(actorUserId, auditContext),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(h.supabaseService.getClient).not.toHaveBeenCalled();
    expect(h.from).not.toHaveBeenCalled();
    expect(h.logUserMembershipDeactivation).not.toHaveBeenCalled();
  });

  it('07 — writes only inactive status during deactivation', async () => {
    const h = makeHarness();

    await h.service.deactivate(targetUserId, auditContext);

    expect(h.updateQuery.update).toHaveBeenCalledTimes(1);
    expect(h.updateQuery.update).toHaveBeenCalledWith({
      status: 'inactive',
    });
  });

  it('08 — CAS includes target user', async () => {
    const h = makeHarness();

    await h.service.deactivate(targetUserId, auditContext);

    expect(h.updateQuery.eq).toHaveBeenCalledWith(
      'user_id',
      targetUserId,
    );
  });

  it('09 — CAS includes current organization', async () => {
    const h = makeHarness();

    await h.service.deactivate(targetUserId, auditContext);

    expect(h.updateQuery.eq).toHaveBeenCalledWith(
      'organization_id',
      organizationId,
    );
  });

  it('10 — CAS requires before status active', async () => {
    const h = makeHarness();

    await h.service.deactivate(targetUserId, auditContext);

    expect(h.updateQuery.eq).toHaveBeenCalledWith(
      'status',
      'active',
    );
  });

  it('11 — successful CAS requires and accepts exactly one row', async () => {
    const h = makeHarness();

    await expect(
      h.service.deactivate(targetUserId, auditContext),
    ).resolves.toEqual({
      userId: targetUserId,
      membershipStatus: 'inactive',
    });

    expect(h.logUserMembershipDeactivation).toHaveBeenCalledTimes(1);
  });

  it('12 — zero-row CAS result fails closed', async () => {
    const h = makeHarness({
      updateResult: { data: [], error: null },
    });

    await expect(
      h.service.deactivate(targetUserId, auditContext),
    ).rejects.toBeInstanceOf(InternalServerErrorException);

    expect(h.logUserMembershipDeactivation).not.toHaveBeenCalled();
  });

  it('13 — update query failure fails closed', async () => {
    const h = makeHarness({
      updateResult: {
        data: null,
        error: { message: 'update failed' },
      },
    });

    await expect(
      h.service.deactivate(targetUserId, auditContext),
    ).rejects.toBeInstanceOf(InternalServerErrorException);

    expect(h.logUserMembershipDeactivation).not.toHaveBeenCalled();
  });

  it('14 — rejects an updated row belonging to another organization', async () => {
    const h = makeHarness({
      updateResult: {
        data: [{
          ...inactiveMembership,
          organization_id: 'org-b',
        }],
        error: null,
      },
    });

    await expect(
      h.service.deactivate(targetUserId, auditContext),
    ).rejects.toBeInstanceOf(InternalServerErrorException);

    expect(h.logUserMembershipDeactivation).not.toHaveBeenCalled();
  });

  it('15 — never accesses auth identity tables', async () => {
    const h = makeHarness();

    await h.service.deactivate(targetUserId, auditContext);

    expect(h.from).toHaveBeenCalledTimes(2);
    expect(h.from).toHaveBeenNthCalledWith(
      1,
      'organization_members',
    );
    expect(h.from).toHaveBeenNthCalledWith(
      2,
      'organization_members',
    );
  });

  it('16 — never accesses user_profiles', async () => {
    const h = makeHarness();

    await h.service.deactivate(targetUserId, auditContext);

    expect(
      h.from.mock.calls.some(([table]) => table === 'user_profiles'),
    ).toBe(false);
  });

  it('17 — never accesses user_roles', async () => {
    const h = makeHarness();

    await h.service.deactivate(targetUserId, auditContext);

    expect(
      h.from.mock.calls.some(([table]) => table === 'user_roles'),
    ).toBe(false);
  });

  it('18 — emits exact persistent audit context after successful mutation', async () => {
    const h = makeHarness();

    await h.service.deactivate(targetUserId, auditContext);

    expect(
      h.logUserMembershipDeactivation,
    ).toHaveBeenCalledTimes(1);

    expect(
      h.logUserMembershipDeactivation,
    ).toHaveBeenCalledWith({
      actorUserId,
      organizationId,
      targetUserId,
      membershipId,
      beforeStatus: 'active',
      afterStatus: 'inactive',
      ipAddress: '127.0.0.1',
      userAgent: 'f1.2.3b-test',
    });
  });

  it('19 — audit failure triggers rollback', async () => {
    const h = makeHarness({
      auditError: new Error('audit failed'),
    });

    await expect(
      h.service.deactivate(targetUserId, auditContext),
    ).rejects.toThrow('operation was reverted');

    expect(h.rollbackQuery.update).toHaveBeenCalledWith({
      status: 'active',
    });
  });

  it('20 — rollback is scoped to target user', async () => {
    const h = makeHarness({
      auditError: new Error('audit failed'),
    });

    await expect(
      h.service.deactivate(targetUserId, auditContext),
    ).rejects.toBeInstanceOf(InternalServerErrorException);

    expect(h.rollbackQuery.eq).toHaveBeenCalledWith(
      'user_id',
      targetUserId,
    );
  });

  it('21 — rollback is scoped to current organization', async () => {
    const h = makeHarness({
      auditError: new Error('audit failed'),
    });

    await expect(
      h.service.deactivate(targetUserId, auditContext),
    ).rejects.toBeInstanceOf(InternalServerErrorException);

    expect(h.rollbackQuery.eq).toHaveBeenCalledWith(
      'organization_id',
      organizationId,
    );
  });

  it('22 — rollback requires current status inactive', async () => {
    const h = makeHarness({
      auditError: new Error('audit failed'),
    });

    await expect(
      h.service.deactivate(targetUserId, auditContext),
    ).rejects.toBeInstanceOf(InternalServerErrorException);

    expect(h.rollbackQuery.eq).toHaveBeenCalledWith(
      'status',
      'inactive',
    );
  });

  it('23 — confirmed rollback returns reverted-operation error', async () => {
    const h = makeHarness({
      auditError: new Error('audit failed'),
    });

    await expect(
      h.service.deactivate(targetUserId, auditContext),
    ).rejects.toThrow(
      'Membership deactivation audit failed; operation was reverted',
    );
  });

  it('24 — unconfirmed rollback returns CRITICAL error', async () => {
    const h = makeHarness({
      auditError: new Error('audit failed'),
      rollbackResult: {
        data: [],
        error: null,
      },
    });

    await expect(
      h.service.deactivate(targetUserId, auditContext),
    ).rejects.toThrow('CRITICAL:');
  });
});
