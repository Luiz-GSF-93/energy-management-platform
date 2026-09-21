import {
  BadRequestException,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { UsersService } from './users.service';

describe('UsersService organization-scoped reads', () => {
  const organizationId = 'org-a';
  const targetUserId = 'target-user';

  let responses: Record<string, Array<{ data: any; error: any }>>;
  let calls: Array<{
    table: string;
    select?: string;
    filters: Array<[string, any]>;
    inFilters: Array<[string, any[]]>;
  }>;
  let service: UsersService;

  function makeBuilder(table: string) {
    const call = {
      table,
      select: undefined as string | undefined,
      filters: [] as Array<[string, any]>,
      inFilters: [] as Array<[string, any[]]>,
    };

    const builder: any = {
      select: jest.fn((value: string) => {
        call.select = value;
        return builder;
      }),
      eq: jest.fn((field: string, value: any) => {
        call.filters.push([field, value]);
        return builder;
      }),
      in: jest.fn((field: string, value: any[]) => {
        call.inFilters.push([field, value]);
        return builder;
      }),
      then: (resolve: any, reject: any) => {
        calls.push(call);
        const result = responses[table]?.shift() ?? {
          data: null,
          error: null,
        };
        return Promise.resolve(result).then(resolve, reject);
      },
    };

    return builder;
  }

  beforeEach(() => {
    responses = {};
    calls = [];

    const client = {
      from: jest.fn((table: string) => makeBuilder(table)),
    };

    service = new UsersService(
      { getClient: () => client } as any,
      { logUserAffiliationChange: jest.fn() } as any,
    );
  });

  function validMembership(userId = targetUserId) {
    return {
      user_id: userId,
      organization_id: organizationId,
      role_id: 'role-a',
      status: 'active',
      invited_at: null,
      accepted_at: '2026-09-20T10:00:00.000Z',
      roles: {
        id: 'role-a',
        name: 'gestor',
        organization_id: organizationId,
        scope: 'organization',
      },
    };
  }

  function validProfile(userId = targetUserId) {
    return {
      user_id: userId,
      email: 'user@example.test',
      name: 'Example User',
      affiliation_type: 'internal',
    };
  }

  it('A — list starts from organization_members and scopes organization', async () => {
    responses.organization_members = [{ data: [], error: null }];

    await expect(service.findAll(organizationId)).resolves.toEqual([]);

    expect(calls).toHaveLength(1);
    expect(calls[0].table).toBe('organization_members');
    expect(calls[0].filters).toContainEqual([
      'organization_id',
      organizationId,
    ]);
  });

  it('B — empty list does not query profiles', async () => {
    responses.organization_members = [{ data: [], error: null }];

    await service.findAll(organizationId);

    expect(calls.map((call) => call.table)).toEqual([
      'organization_members',
    ]);
  });

  it('C — list bounds profile query to authorized IDs', async () => {
    responses.organization_members = [
      {
        data: [
          validMembership('user-a'),
          validMembership('user-b'),
        ],
        error: null,
      },
    ];
    responses.user_profiles = [
      {
        data: [validProfile('user-a'), validProfile('user-b')],
        error: null,
      },
    ];

    await service.findAll(organizationId);

    expect(calls[0].table).toBe('organization_members');
    expect(calls[1].table).toBe('user_profiles');
    expect(calls[1].inFilters).toEqual([
      ['user_id', ['user-a', 'user-b']],
    ]);
  });

  it('D — list composes safe response', async () => {
    responses.organization_members = [
      { data: [validMembership()], error: null },
    ];
    responses.user_profiles = [
      { data: [validProfile()], error: null },
    ];

    await expect(service.findAll(organizationId)).resolves.toEqual([
      {
        userId: targetUserId,
        email: 'user@example.test',
        name: 'Example User',
        affiliationType: 'internal',
        membershipStatus: 'active',
        role: {
          id: 'role-a',
          name: 'gestor',
        },
        invitedAt: null,
        acceptedAt: '2026-09-20T10:00:00.000Z',
      },
    ]);
  });

  it('E — list fails closed on membership query error', async () => {
    responses.organization_members = [
      { data: null, error: { message: 'db error' } },
    ];

    await expect(
      service.findAll(organizationId),
    ).rejects.toBeInstanceOf(InternalServerErrorException);
  });

  it('F — list fails closed on profile query error', async () => {
    responses.organization_members = [
      { data: [validMembership()], error: null },
    ];
    responses.user_profiles = [
      { data: null, error: { message: 'db error' } },
    ];

    await expect(
      service.findAll(organizationId),
    ).rejects.toBeInstanceOf(InternalServerErrorException);
  });

  it('G — list fails closed on missing profile', async () => {
    responses.organization_members = [
      { data: [validMembership()], error: null },
    ];
    responses.user_profiles = [{ data: [], error: null }];

    await expect(
      service.findAll(organizationId),
    ).rejects.toThrow('user profile missing');
  });

  it('H — list fails closed on duplicate profile', async () => {
    responses.organization_members = [
      { data: [validMembership()], error: null },
    ];
    responses.user_profiles = [
      {
        data: [validProfile(), validProfile()],
        error: null,
      },
    ];

    await expect(
      service.findAll(organizationId),
    ).rejects.toThrow('multiple user profiles');
  });

  it('I — list rejects unauthorized profile returned by data layer', async () => {
    responses.organization_members = [
      { data: [validMembership()], error: null },
    ];
    responses.user_profiles = [
      {
        data: [validProfile(), validProfile('other-user')],
        error: null,
      },
    ];

    await expect(
      service.findAll(organizationId),
    ).rejects.toThrow('unauthorized user profile');
  });

  it('J — list fails closed on missing role', async () => {
    const membership = validMembership();
    membership.roles = null as any;

    responses.organization_members = [
      { data: [membership], error: null },
    ];

    await expect(
      service.findAll(organizationId),
    ).rejects.toThrow('invalid organization role');

    expect(calls.map((call) => call.table)).toEqual([
      'organization_members',
    ]);
  });

  it('K — list fails closed on null role_id', async () => {
    const membership = validMembership();
    membership.role_id = null as any;

    responses.organization_members = [
      { data: [membership], error: null },
    ];

    await expect(
      service.findAll(organizationId),
    ).rejects.toThrow('invalid organization membership');
  });

  it('L — list fails closed on role id mismatch', async () => {
    const membership = validMembership();
    membership.role_id = 'role-other';

    responses.organization_members = [
      { data: [membership], error: null },
    ];

    await expect(
      service.findAll(organizationId),
    ).rejects.toThrow('invalid organization role');
  });

  it('M — list fails closed on role organization mismatch', async () => {
    const membership = validMembership();
    membership.roles.organization_id = 'org-b';

    responses.organization_members = [
      { data: [membership], error: null },
    ];

    await expect(
      service.findAll(organizationId),
    ).rejects.toThrow('invalid organization role');
  });

  it('N — list fails closed on global role', async () => {
    const membership = validMembership();
    membership.roles.scope = 'global';

    responses.organization_members = [
      { data: [membership], error: null },
    ];

    await expect(
      service.findAll(organizationId),
    ).rejects.toThrow('invalid organization role');
  });

  it('O — list fails closed on invalid affiliation', async () => {
    const profile = validProfile();
    profile.affiliation_type = 'invalid';

    responses.organization_members = [
      { data: [validMembership()], error: null },
    ];
    responses.user_profiles = [
      { data: [profile], error: null },
    ];

    await expect(
      service.findAll(organizationId),
    ).rejects.toThrow('invalid user profile');
  });

  it('P — read one queries membership before profile and scopes target + organization', async () => {
    responses.organization_members = [
      { data: [validMembership()], error: null },
    ];
    responses.user_profiles = [
      { data: [validProfile()], error: null },
    ];

    await service.findOne(targetUserId, organizationId);

    expect(calls[0].table).toBe('organization_members');
    expect(calls[0].filters).toContainEqual([
      'user_id',
      targetUserId,
    ]);
    expect(calls[0].filters).toContainEqual([
      'organization_id',
      organizationId,
    ]);
    expect(calls[1].table).toBe('user_profiles');
  });

  it('Q — read one missing membership returns NotFound and performs no profile query', async () => {
    responses.organization_members = [{ data: [], error: null }];

    await expect(
      service.findOne(targetUserId, organizationId),
    ).rejects.toBeInstanceOf(NotFoundException);

    expect(calls.map((call) => call.table)).toEqual([
      'organization_members',
    ]);
  });

  it('R — read one duplicate membership fails closed', async () => {
    responses.organization_members = [
      {
        data: [validMembership(), validMembership()],
        error: null,
      },
    ];

    await expect(
      service.findOne(targetUserId, organizationId),
    ).rejects.toThrow('multiple target memberships');
  });

  it('S — read one returns safe response', async () => {
    responses.organization_members = [
      { data: [validMembership()], error: null },
    ];
    responses.user_profiles = [
      { data: [validProfile()], error: null },
    ];

    await expect(
      service.findOne(targetUserId, organizationId),
    ).resolves.toEqual({
      userId: targetUserId,
      email: 'user@example.test',
      name: 'Example User',
      affiliationType: 'internal',
      membershipStatus: 'active',
      role: {
        id: 'role-a',
        name: 'gestor',
      },
      invitedAt: null,
      acceptedAt: '2026-09-20T10:00:00.000Z',
    });
  });

  it('T — read one fails closed on membership query error', async () => {
    responses.organization_members = [
      { data: null, error: { message: 'db error' } },
    ];

    await expect(
      service.findOne(targetUserId, organizationId),
    ).rejects.toBeInstanceOf(InternalServerErrorException);
  });

  it('U — read one fails closed on profile query error', async () => {
    responses.organization_members = [
      { data: [validMembership()], error: null },
    ];
    responses.user_profiles = [
      { data: null, error: { message: 'db error' } },
    ];

    await expect(
      service.findOne(targetUserId, organizationId),
    ).rejects.toBeInstanceOf(InternalServerErrorException);
  });

  it('V — read one missing profile is integrity failure', async () => {
    responses.organization_members = [
      { data: [validMembership()], error: null },
    ];
    responses.user_profiles = [{ data: [], error: null }];

    await expect(
      service.findOne(targetUserId, organizationId),
    ).rejects.toThrow('user profile missing');
  });

  it('W — read one duplicate profile is integrity failure', async () => {
    responses.organization_members = [
      { data: [validMembership()], error: null },
    ];
    responses.user_profiles = [
      {
        data: [validProfile(), validProfile()],
        error: null,
      },
    ];

    await expect(
      service.findOne(targetUserId, organizationId),
    ).rejects.toThrow('multiple user profiles');
  });

  it('X — read one malformed role fails closed', async () => {
    const membership = validMembership();
    membership.roles = null as any;

    responses.organization_members = [
      { data: [membership], error: null },
    ];

    await expect(
      service.findOne(targetUserId, organizationId),
    ).rejects.toThrow('invalid organization role');
  });

  it('Y — read one role organization mismatch fails closed', async () => {
    const membership = validMembership();
    membership.roles.organization_id = 'org-b';

    responses.organization_members = [
      { data: [membership], error: null },
    ];

    await expect(
      service.findOne(targetUserId, organizationId),
    ).rejects.toThrow('invalid organization role');
  });

  it('Z — read one global role fails closed', async () => {
    const membership = validMembership();
    membership.roles.scope = 'global';

    responses.organization_members = [
      { data: [membership], error: null },
    ];

    await expect(
      service.findOne(targetUserId, organizationId),
    ).rejects.toThrow('invalid organization role');
  });

  it('AA — read one invalid affiliation fails closed', async () => {
    const profile = validProfile();
    profile.affiliation_type = 'invalid';

    responses.organization_members = [
      { data: [validMembership()], error: null },
    ];
    responses.user_profiles = [
      { data: [profile], error: null },
    ];

    await expect(
      service.findOne(targetUserId, organizationId),
    ).rejects.toThrow('invalid user profile');
  });
});

describe('UsersService.updateAffiliation', () => {
  const actorUserId = 'actor-user';
  const targetUserId = 'target-user';
  const organizationId = 'org-a';

  const auditContext = {
    actorUserId,
    organizationId,
    ipAddress: '127.0.0.1',
    userAgent: 'test-agent',
  };

  let queues: Record<string, Array<{ data: any; error: any }>>;
  let calls: Array<{ table: string; operation: string; payload?: any }>;
  let auditService: { logUserAffiliationChange: jest.Mock };
  let service: UsersService;

  function makeBuilder(table: string) {
    let operation = 'select';
    let payload: any;

    const builder: any = {
      select: jest.fn(() => {
        if (operation === 'update') {
          const result = queues[`${table}:update`]?.shift() ?? {
            data: null,
            error: null,
          };
          calls.push({ table, operation, payload });
          return Promise.resolve(result);
        }

        operation = 'select';
        return builder;
      }),
      update: jest.fn((value: any) => {
        operation = 'update';
        payload = value;
        return builder;
      }),
      eq: jest.fn(() => builder),
      then: (resolve: any, reject: any) => {
        const result = queues[`${table}:${operation}`]?.shift() ?? {
          data: null,
          error: null,
        };
        calls.push({ table, operation, payload });
        return Promise.resolve(result).then(resolve, reject);
      },
    };

    return builder;
  }

  beforeEach(() => {
    queues = {};
    calls = [];

    const client = {
      from: jest.fn((table: string) => makeBuilder(table)),
    };

    auditService = {
      logUserAffiliationChange: jest.fn().mockResolvedValue(undefined),
    };

    service = new UsersService(
      { getClient: () => client } as any,
      auditService as any,
    );
  });

  function membership(data: any[] = [
    {
      user_id: targetUserId,
      organization_id: organizationId,
      status: 'active',
    },
  ]) {
    queues['organization_members:select'] = [{ data, error: null }];
  }

  function profile(type: 'internal' | 'external' = 'internal') {
    queues['user_profiles:select'] = [
      {
        data: [{ user_id: targetUserId, affiliation_type: type }],
        error: null,
      },
    ];
  }

  it('A — changes affiliation and audits before/after', async () => {
    membership();
    profile('internal');
    queues['user_profiles:update'] = [
      {
        data: [{ user_id: targetUserId, affiliation_type: 'external' }],
        error: null,
      },
    ];

    await expect(
      service.updateAffiliation(targetUserId, 'external', auditContext),
    ).resolves.toEqual({
      userId: targetUserId,
      affiliationType: 'external',
    });

    expect(auditService.logUserAffiliationChange).toHaveBeenCalledWith({
      actorUserId,
      organizationId,
      targetUserId,
      before: 'internal',
      after: 'external',
      ipAddress: '127.0.0.1',
      userAgent: 'test-agent',
    });
  });

  it('B — is idempotent without update or audit', async () => {
    membership();
    profile('internal');

    await expect(
      service.updateAffiliation(targetUserId, 'internal', auditContext),
    ).resolves.toEqual({
      userId: targetUserId,
      affiliationType: 'internal',
    });

    expect(
      calls.filter((call) => call.operation === 'update'),
    ).toHaveLength(0);
    expect(auditService.logUserAffiliationChange).not.toHaveBeenCalled();
  });

  it('C — rejects target without active membership in current org', async () => {
    membership([]);

    await expect(
      service.updateAffiliation(targetUserId, 'external', auditContext),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('D — fails closed on membership query error', async () => {
    queues['organization_members:select'] = [
      { data: null, error: { message: 'db error' } },
    ];

    await expect(
      service.updateAffiliation(targetUserId, 'external', auditContext),
    ).rejects.toBeInstanceOf(InternalServerErrorException);
  });

  it('E — rejects missing target profile', async () => {
    membership();
    queues['user_profiles:select'] = [{ data: [], error: null }];

    await expect(
      service.updateAffiliation(targetUserId, 'external', auditContext),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('F — detects CAS/concurrent affiliation change', async () => {
    membership();
    profile('internal');
    queues['user_profiles:update'] = [{ data: [], error: null }];

    await expect(
      service.updateAffiliation(targetUserId, 'external', auditContext),
    ).rejects.toThrow('User affiliation changed concurrently');

    expect(auditService.logUserAffiliationChange).not.toHaveBeenCalled();
  });

  it('G — fails closed on affiliation update error', async () => {
    membership();
    profile('internal');
    queues['user_profiles:update'] = [
      { data: null, error: { message: 'update failed' } },
    ];

    await expect(
      service.updateAffiliation(targetUserId, 'external', auditContext),
    ).rejects.toThrow('Failed to update user affiliation');

    expect(auditService.logUserAffiliationChange).not.toHaveBeenCalled();
  });

  it('H — reverts affiliation when audit fails', async () => {
    membership();
    profile('internal');

    queues['user_profiles:update'] = [
      {
        data: [{ user_id: targetUserId, affiliation_type: 'external' }],
        error: null,
      },
      {
        data: [{ user_id: targetUserId }],
        error: null,
      },
    ];

    auditService.logUserAffiliationChange.mockRejectedValue(
      new Error('audit failed'),
    );

    await expect(
      service.updateAffiliation(targetUserId, 'external', auditContext),
    ).rejects.toThrow('Audit logging failed; affiliation update reverted');

    const updates = calls.filter(
      (call) =>
        call.table === 'user_profiles' &&
        call.operation === 'update',
    );

    expect(updates).toHaveLength(2);
    expect(updates[1].payload.affiliation_type).toBe('internal');
  });

  it('I — reports unconfirmed rollback after audit failure', async () => {
    membership();
    profile('internal');

    queues['user_profiles:update'] = [
      {
        data: [{ user_id: targetUserId, affiliation_type: 'external' }],
        error: null,
      },
      {
        data: [],
        error: null,
      },
    ];

    auditService.logUserAffiliationChange.mockRejectedValue(
      new Error('audit failed'),
    );

    await expect(
      service.updateAffiliation(targetUserId, 'external', auditContext),
    ).rejects.toThrow(
      'Audit logging failed and affiliation rollback could not be confirmed',
    );
  });

  it('J — rejects invalid affiliation defensively', async () => {
    await expect(
      service.updateAffiliation(
        targetUserId,
        'invalid' as any,
        auditContext,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(calls).toHaveLength(0);
    expect(auditService.logUserAffiliationChange).not.toHaveBeenCalled();
  });
});
