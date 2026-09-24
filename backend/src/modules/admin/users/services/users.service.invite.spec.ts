import {
  BadRequestException,
  ConflictException,
  InternalServerErrorException,
} from '@nestjs/common';
import { UsersService } from './users.service';

describe('UsersService.invite — F1.2.4c.2.2b.1', () => {
  const actorUserId = '11111111-1111-4111-8111-111111111111';
  const organizationId = '22222222-2222-4222-8222-222222222222';
  const roleId = '33333333-3333-4333-8333-333333333333';
  const userId = '44444444-4444-4444-8444-444444444444';
  const membershipId = '55555555-5555-4555-8555-555555555555';

  const dto = {
    email: 'Invitee@Example.com',
    name: 'Invitee User',
    roleId,
    affiliationType: 'external' as const,
  };

  const auditContext = {
    actorUserId,
    organizationId,
    ipAddress: '203.0.113.10',
    userAgent: 'invite-service-test',
  };

  function query(result: any) {
    const q: any = {
      select: jest.fn(() => q),
      eq: jest.fn(() => q),
      is: jest.fn(() => q),
      insert: jest.fn(() => q),
      update: jest.fn(() => q),
      delete: jest.fn(() => q),
      then: (resolve: any) => Promise.resolve(result).then(resolve),
    };
    return q;
  }

  function harness(options: {
    profiles?: any[];
    memberships?: any[];
    authUsers?: any[];
    authListResponse?: any;
    inviteUser?: any;
    profileInsertRows?: any[];
    affiliationType?: 'internal' | 'external';
    auditReject?: boolean;
    membershipInsertError?: any;
  } = {}) {
    const compensationOrder: string[] = [];

    const profileAffiliation =
      options.affiliationType ?? 'external';

    const roleQuery = query({
      data: [
        {
          id: roleId,
          name: 'Manager',
          organization_id: organizationId,
          scope: 'organization',
        },
      ],
      error: null,
    });

    const profileLookup = query({
      data:
        options.profiles ??
        [
          {
            user_id: userId,
            email: 'invitee@example.com',
            name: 'Existing User',
            organization_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
            affiliation_type: profileAffiliation,
          },
        ],
      error: null,
    });

    const membershipLookup = query({
      data: options.memberships ?? [],
      error: null,
    });

    const membershipInsert = query({
      data: options.membershipInsertError
        ? null
        : [
            {
              id: membershipId,
              user_id: userId,
              organization_id: organizationId,
              role_id: roleId,
              status: 'active',
            },
          ],
      error: options.membershipInsertError ?? null,
    });

    const profileInsert = query({
      data:
        options.profileInsertRows ??
        [
          {
            user_id: userId,
            email: 'invitee@example.com',
            organization_id: organizationId,
            affiliation_type: 'external',
          },
        ],
      error: null,
    });

    const membershipDelete = query({
      data: [{ id: membershipId }],
      error: null,
    });

    const originalMembershipDelete =
      membershipDelete.delete.getMockImplementation();

    membershipDelete.delete.mockImplementation(() => {
      compensationOrder.push('membership');
      return originalMembershipDelete!();
    });

    const profileDelete = query({
      data: [{ user_id: userId }],
      error: null,
    });

    const originalProfileDelete =
      profileDelete.delete.getMockImplementation();

    profileDelete.delete.mockImplementation(() => {
      compensationOrder.push('profile');
      return originalProfileDelete!();
    });

    const queues: Record<string, any[]> = {
      roles: [roleQuery],
      user_profiles: [profileLookup, profileInsert, profileDelete],
      organization_members: [
        membershipLookup,
        membershipInsert,
        membershipDelete,
      ],
    };

    const client = {
      from: jest.fn((table: string) => {
        const next = queues[table]?.shift();
        if (!next) {
          throw new Error(`Unexpected table query: ${table}`);
        }
        return next;
      }),
    };

    const authAdmin = {
      getUserById: jest.fn().mockResolvedValue({
        data: {
          user: {
            id: userId,
            email: 'invitee@example.com',
          },
        },
        error: null,
      }),
      listUsers: jest.fn().mockResolvedValue(
        options.authListResponse ?? {
          data: {
            users: options.authUsers ?? [],
            lastPage: 1,
          },
          error: null,
        },
      ),
      inviteUserByEmail: jest.fn().mockResolvedValue(
        options.inviteUser ?? {
          data: {
            user: {
              id: userId,
              email: 'invitee@example.com',
            },
          },
          error: null,
        },
      ),
      deleteUser: jest.fn().mockImplementation(async () => {
        compensationOrder.push('identity');

        return {
          data: {},
          error: null,
        };
      }),
    };

    const supabaseService = {
      getClient: jest.fn(() => client),
      createAuthClient: jest.fn(() => ({
        auth: {
          admin: authAdmin,
        },
      })),
    };

    const auditService = {
      logUserInvite: options.auditReject
        ? jest.fn().mockRejectedValue(new Error('audit failure'))
        : jest.fn().mockResolvedValue(undefined),
    };

    const service = new UsersService(
      supabaseService as any,
      auditService as any,
    );

    return {
      service,
      client,
      authAdmin,
      auditService,
      membershipInsert,
      membershipDelete,
      profileInsert,
      profileDelete,
      compensationOrder,
    };
  }

  it('reuses an existing identity/profile and creates only membership', async () => {
    const h = harness();

    await expect(
      h.service.invite(dto as any, auditContext),
    ).resolves.toEqual({
      userId,
      membershipId,
      membershipStatus: 'active',
      provisioningPath: 'existing_identity',
    });

    expect(h.authAdmin.getUserById).toHaveBeenCalledWith(userId);
    expect(h.authAdmin.inviteUserByEmail).not.toHaveBeenCalled();
    expect(h.authAdmin.deleteUser).not.toHaveBeenCalled();

    expect(h.auditService.logUserInvite).toHaveBeenCalledWith({
      actorUserId,
      organizationId,
      targetUserId: userId,
      membershipId,
      email: 'invitee@example.com',
      roleId,
      affiliationType: 'external',
      provisioningPath: 'existing_identity',
      ipAddress: '203.0.113.10',
      userAgent: 'invite-service-test',
    });
  });

  it('rejects a role outside the active organization contract', async () => {
    const h = harness();

    const badDto = {
      ...dto,
      roleId: '99999999-9999-4999-8999-999999999999',
    };

    await expect(
      h.service.invite(badDto as any, auditContext),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects existing active membership without role mutation', async () => {
    const h = harness({
      memberships: [
        {
          id: membershipId,
          user_id: userId,
          organization_id: organizationId,
          role_id: roleId,
          status: 'active',
        },
      ],
    });

    await expect(
      h.service.invite(dto as any, auditContext),
    ).rejects.toBeInstanceOf(ConflictException);

    expect(h.auditService.logUserInvite).not.toHaveBeenCalled();
  });

  it('rejects inactive membership and does not reactivate', async () => {
    const h = harness({
      memberships: [
        {
          id: membershipId,
          user_id: userId,
          organization_id: organizationId,
          role_id: roleId,
          status: 'inactive',
        },
      ],
    });

    await expect(
      h.service.invite(dto as any, auditContext),
    ).rejects.toBeInstanceOf(ConflictException);

    expect(h.auditService.logUserInvite).not.toHaveBeenCalled();
  });

  it('allows different affiliation per organization without rewriting profile', async () => {
    const h=harness({affiliationType:'internal'});
    await expect(h.service.invite(dto as any,auditContext)).resolves.toMatchObject({membershipStatus:'active'});
    expect(h.membershipInsert.insert).toHaveBeenCalledWith(expect.objectContaining({affiliation_type:'external',organization_id:organizationId,display_name:'Invitee User'}));
  });

  it('fails closed when Auth identity exists without profile', async () => {
    const h = harness({
      profiles: [],
      authUsers: [
        {
          id: userId,
          email: 'invitee@example.com',
        },
      ],
    });

    await expect(
      h.service.invite(dto as any, auditContext),
    ).rejects.toBeInstanceOf(ConflictException);

    expect(h.authAdmin.inviteUserByEmail).not.toHaveBeenCalled();
  });

  it('fails closed when bounded Auth pagination cannot prove exhaustion', async () => {
    const fullPage = Array.from({ length: 100 }, (_, index) => ({
      id: `page-user-${index}`,
      email: `page-user-${index}@example.test`,
    }));

    const h = harness({
      profiles: [],
      authListResponse: {
        data: {
          users: fullPage,
          lastPage: 21,
        },
        error: null,
      },
    });

    await expect(
      h.service.invite(dto as any, auditContext),
    ).rejects.toBeInstanceOf(InternalServerErrorException);

    expect(h.authAdmin.listUsers).toHaveBeenCalledTimes(20);
    expect(h.authAdmin.inviteUserByEmail).not.toHaveBeenCalled();
  });

  it('fails closed when invited Auth identity email does not match request', async () => {
    const h = harness({
      profiles: [],
      authUsers: [],
      inviteUser: {
        data: {
          user: {
            id: userId,
            email: 'different@example.com',
          },
        },
        error: null,
      },
    });

    await expect(
      h.service.invite(dto as any, auditContext),
    ).rejects.toBeInstanceOf(InternalServerErrorException);

    expect(h.authAdmin.inviteUserByEmail).toHaveBeenCalledTimes(1);
    expect(h.auditService.logUserInvite).not.toHaveBeenCalled();
  });

  it('fails closed when inserted profile return violates invite integrity', async () => {
    const h = harness({
      profiles: [],
      authUsers: [],
      profileInsertRows: [
        {
          user_id: userId,
          email: 'invitee@example.com',
          organization_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
          affiliation_type: 'external',
        },
      ],
    });

    await expect(
      h.service.invite(dto as any, auditContext),
    ).rejects.toBeInstanceOf(InternalServerErrorException);

    expect(h.auditService.logUserInvite).not.toHaveBeenCalled();
  });

  it('maps membership uniqueness race to conflict', async () => {
    const h = harness({
      membershipInsertError: {
        code: '23505',
      },
    });

    await expect(
      h.service.invite(dto as any, auditContext),
    ).rejects.toBeInstanceOf(ConflictException);

    expect(h.auditService.logUserInvite).not.toHaveBeenCalled();
  });

  it('compensates owned membership when audit fails for existing identity', async () => {
    const h = harness({
      auditReject: true,
    });

    await expect(
      h.service.invite(dto as any, auditContext),
    ).rejects.toBeInstanceOf(InternalServerErrorException);

    expect(h.membershipDelete.delete).toHaveBeenCalledTimes(1);
    expect(h.authAdmin.deleteUser).not.toHaveBeenCalled();
  });


  it('creates identity, explicit profile and membership for a new user', async () => {
    const h = harness({
      profiles: [],
      authUsers: [],
    });

    await expect(
      h.service.invite(dto as any, auditContext),
    ).resolves.toEqual({
      userId,
      membershipId,
      membershipStatus: 'active',
      provisioningPath: 'new_identity',
    });

    expect(h.authAdmin.inviteUserByEmail).toHaveBeenCalledTimes(1);
    expect(h.authAdmin.inviteUserByEmail).toHaveBeenCalledWith(
      'invitee@example.com',
      {
        data: {
          name: 'Invitee User',
        },
        redirectTo: expect.stringContaining('/auth/accept-invite'),
      },
    );

    expect(h.authAdmin.deleteUser).not.toHaveBeenCalled();
    // Production user_profiles.id has no database default (NOT NULL).
    expect(h.profileInsert.insert).toHaveBeenCalledWith(expect.objectContaining({
      id: expect.stringMatching(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i),
      user_id: userId,
      organization_id: organizationId,
    }));
    expect(h.compensationOrder).toEqual([]);

    expect(h.auditService.logUserInvite).toHaveBeenCalledWith(
      expect.objectContaining({
        actorUserId,
        organizationId,
        targetUserId: userId,
        membershipId,
        email: 'invitee@example.com',
        roleId,
        affiliationType: 'external',
        provisioningPath: 'new_identity',
      }),
    );
  });

  it('compensates new identity in membership -> profile -> identity order when audit fails', async () => {
    const h = harness({
      profiles: [],
      authUsers: [],
      auditReject: true,
    });

    await expect(
      h.service.invite(dto as any, auditContext),
    ).rejects.toBeInstanceOf(InternalServerErrorException);

    expect(h.auditService.logUserInvite).toHaveBeenCalledTimes(1);

    expect(h.membershipDelete.delete).toHaveBeenCalledTimes(1);
    expect(h.profileDelete.delete).toHaveBeenCalledTimes(1);
    expect(h.authAdmin.deleteUser).toHaveBeenCalledTimes(1);

    expect(h.authAdmin.deleteUser).toHaveBeenCalledWith(userId);

    expect(h.compensationOrder).toEqual([
      'membership',
      'profile',
      'identity',
    ]);
  });

  it('never deletes pre-existing profile or identity during existing-identity compensation', async () => {
    const h = harness({
      auditReject: true,
    });

    await expect(
      h.service.invite(dto as any, auditContext),
    ).rejects.toBeInstanceOf(InternalServerErrorException);

    expect(h.membershipDelete.delete).toHaveBeenCalledTimes(1);
    expect(h.profileDelete.delete).not.toHaveBeenCalled();
    expect(h.authAdmin.deleteUser).not.toHaveBeenCalled();

    expect(h.compensationOrder).toEqual([
      'membership',
    ]);
  });


  it('continues compensation after membership rollback throws', async () => {
    const h = harness({
      profiles: [],
      authUsers: [],
      auditReject: true,
    });

    h.membershipDelete.delete.mockImplementation(() => {
      h.compensationOrder.push('membership');
      throw new Error('membership rollback transport failure');
    });

    await expect(
      h.service.invite(dto as any, auditContext),
    ).rejects.toBeInstanceOf(InternalServerErrorException);

    expect(h.membershipDelete.delete).toHaveBeenCalledTimes(1);
    expect(h.profileDelete.delete).toHaveBeenCalledTimes(1);
    expect(h.authAdmin.deleteUser).toHaveBeenCalledTimes(1);

    expect(h.compensationOrder).toEqual([
      'membership',
      'profile',
      'identity',
    ]);
  });

});
