import {
  BadRequestException,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { UsersService } from './users.service';

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
