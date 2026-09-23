import { OrganizationsService } from './organizations.service';

describe('OrganizationsService — CREATE/UPDATE persistent audit', () => {
  const auditContext = {
    actorUserId: 'platform-user',
    ipAddress: '127.0.0.1',
    userAgent: 'f1.5.5-test',
  };

  function emptyDeleteDependencyQuery() {
    const limit = jest.fn().mockResolvedValue({
      data: [],
      error: null,
    });

    const eq = jest.fn(() => ({
      limit,
    }));

    const select = jest.fn(() => ({
      eq,
    }));

    return {
      select,
      eq,
      limit,
    };
  }

  it('A — CREATE persists audit with authenticated actor', async () => {
    const created = {
      id: 'created-org',
      name: 'Created',
      description: null,
      created_at: '2026-09-22T10:00:00.000Z',
      updated_at: '2026-09-22T10:00:00.000Z',
      deleted_at: null,
    };

    const single = jest.fn().mockResolvedValue({
      data: created,
      error: null,
    });
    const select = jest.fn(() => ({ single }));
    const insert = jest.fn(() => ({ select }));

    const client = {
      from: jest.fn(() => ({ insert })),
    };

    const auditService = {
      logCreate: jest.fn().mockResolvedValue(undefined),
    };

    const service = new OrganizationsService(
      { getClient: () => client } as any,
      auditService as any,
    );

    await expect(
      service.create({ name: ' Created ' }, auditContext),
    ).resolves.toEqual(created);

    expect(auditService.logCreate).toHaveBeenCalledWith({
      userId: 'platform-user',
      organizationId: 'created-org',
      resourceType: 'organization',
      resourceId: 'created-org',
      after: created,
      ipAddress: '127.0.0.1',
      userAgent: 'f1.5.5-test',
    });
  });

  it('B — CREATE compensates only the just-created state when audit fails', async () => {
    const created = {
      id: 'created-org',
      name: 'Created',
      description: null,
      created_at: '2026-09-22T10:00:00.000Z',
      updated_at: '2026-09-22T10:00:00.000Z',
      deleted_at: null,
    };

    const single = jest.fn().mockResolvedValue({
      data: created,
      error: null,
    });
    const select = jest.fn(() => ({ single }));
    const insert = jest.fn(() => ({ select }));

    const rollback = {
      eq: jest.fn().mockReturnThis(),
      is: jest.fn().mockResolvedValue({ error: null }),
    };
    const remove = jest.fn(() => rollback);

    const client = {
      from: jest
        .fn()
        .mockReturnValueOnce({ insert })
        .mockReturnValueOnce({ delete: remove }),
    };

    const auditService = {
      logCreate: jest.fn().mockRejectedValue(new Error('audit failed')),
    };

    const service = new OrganizationsService(
      { getClient: () => client } as any,
      auditService as any,
    );

    await expect(
      service.create({ name: 'Created' }, auditContext),
    ).rejects.toThrow('audit failed');

    expect(remove).toHaveBeenCalledTimes(1);
    expect(rollback.eq).toHaveBeenNthCalledWith(1, 'id', 'created-org');
    expect(rollback.eq).toHaveBeenNthCalledWith(
      2,
      'updated_at',
      created.updated_at,
    );
    expect(rollback.is).toHaveBeenCalledWith('deleted_at', null);
  });

  it('C — UPDATE audits exact before and after states', async () => {
    const before = {
      id: 'target-org',
      name: 'Before',
      description: null,
      created_at: '2026-09-20T00:00:00.000Z',
      updated_at: '2026-09-20T00:00:00.000Z',
      deleted_at: null,
    };

    const after = {
      ...before,
      name: 'After',
      updated_at: '2026-09-22T10:00:00.000Z',
    };

    const single = jest.fn().mockResolvedValue({
      data: after,
      error: null,
    });

    const updateQuery = {
      eq: jest.fn().mockReturnThis(),
      is: jest.fn().mockReturnThis(),
      select: jest.fn(() => ({ single })),
    };

    const client = {
      from: jest.fn(() => ({
        update: jest.fn(() => updateQuery),
      })),
    };

    const auditService = {
      logUpdate: jest.fn().mockResolvedValue(undefined),
    };

    const service = new OrganizationsService(
      { getClient: () => client } as any,
      auditService as any,
    );

    jest.spyOn(service, 'findOne').mockResolvedValue(before as any);

    await expect(
      service.update('target-org', { name: 'After' }, auditContext),
    ).resolves.toEqual(after);

    expect(auditService.logUpdate).toHaveBeenCalledWith({
      userId: 'platform-user',
      organizationId: 'target-org',
      resourceType: 'organization',
      resourceId: 'target-org',
      before,
      after,
      ipAddress: '127.0.0.1',
      userAgent: 'f1.5.5-test',
    });
  });

  it('D — UPDATE compensation is guarded by the written updated_at', async () => {
    const before = {
      id: 'target-org',
      name: 'Before',
      description: null,
      created_at: '2026-09-20T00:00:00.000Z',
      updated_at: '2026-09-20T00:00:00.000Z',
      deleted_at: null,
    };

    const after = {
      ...before,
      name: 'After',
      updated_at: '2026-09-22T10:00:00.000Z',
    };

    const writeSingle = jest.fn().mockResolvedValue({
      data: after,
      error: null,
    });

    const writeQuery = {
      eq: jest.fn().mockReturnThis(),
      is: jest.fn().mockReturnThis(),
      select: jest.fn(() => ({ single: writeSingle })),
    };

    const rollbackQuery = {
      eq: jest.fn().mockReturnThis(),
      is: jest.fn().mockResolvedValue({ error: null }),
    };

    const update = jest
      .fn()
      .mockReturnValueOnce(writeQuery)
      .mockReturnValueOnce(rollbackQuery);

    const client = {
      from: jest.fn(() => ({ update })),
    };

    const auditService = {
      logUpdate: jest.fn().mockRejectedValue(new Error('audit failed')),
    };

    const service = new OrganizationsService(
      { getClient: () => client } as any,
      auditService as any,
    );

    jest.spyOn(service, 'findOne').mockResolvedValue(before as any);

    await expect(
      service.update('target-org', { name: 'After' }, auditContext),
    ).rejects.toThrow('audit failed');

    expect(update).toHaveBeenCalledTimes(2);
    expect(rollbackQuery.eq).toHaveBeenNthCalledWith(1, 'id', 'target-org');
    expect(rollbackQuery.eq).toHaveBeenNthCalledWith(
      2,
      'updated_at',
      after.updated_at,
    );
    expect(rollbackQuery.is).toHaveBeenCalledWith('deleted_at', null);
  });

  it('E — DELETE compensates soft-delete when persistent audit fails', async () => {
    const before = {
      id: 'target-org',
      name: 'Target',
      description: null,
      created_at: '2026-09-20T00:00:00.000Z',
      updated_at: '2026-09-20T00:00:00.000Z',
    };

    const softDeleteQuery = {
      eq: jest.fn().mockReturnThis(),
      is: jest.fn().mockResolvedValue({ error: null }),
    };

    const rollbackQuery = {
      eq: jest.fn().mockReturnThis(),
    };

    rollbackQuery.eq
      .mockReturnValueOnce(rollbackQuery)
      .mockResolvedValueOnce({ error: null });

    const update = jest
      .fn()
      .mockReturnValueOnce(softDeleteQuery)
      .mockReturnValueOnce(rollbackQuery);

    const client = {
      from: jest.fn((table: string) => {
        if (table === 'organizations') {
          return { update };
        }

        return {
          select:
            emptyDeleteDependencyQuery()
              .select,
        };
      }),
    };

    const auditService = {
      logDelete: jest.fn().mockRejectedValue(new Error('audit failed')),
    };

    const service = new OrganizationsService(
      { getClient: () => client } as any,
      auditService as any,
    );

    jest.spyOn(service, 'findOne').mockResolvedValue(before as any);

    await expect(
      service.delete('target-org', auditContext),
    ).rejects.toThrow('audit failed');

    expect(update).toHaveBeenCalledTimes(2);
    expect(rollbackQuery.eq).toHaveBeenNthCalledWith(
      1,
      'id',
      'target-org',
    );
    expect(rollbackQuery.eq).toHaveBeenNthCalledWith(
      2,
      'deleted_at',
      expect.any(String),
    );

    const auditedAfter =
      auditService.logDelete.mock.calls[0][0].after;

    const rollbackDeletedAt =
      rollbackQuery.eq.mock.calls[1][1];

    expect(rollbackDeletedAt).toBe(auditedAfter.deleted_at);
  });

  it('F — DELETE surfaces integrity error when audit and compensation both fail', async () => {
    const before = {
      id: 'target-org',
      name: 'Target',
      description: null,
      created_at: '2026-09-20T00:00:00.000Z',
      updated_at: '2026-09-20T00:00:00.000Z',
    };

    const softDeleteQuery = {
      eq: jest.fn().mockReturnThis(),
      is: jest.fn().mockResolvedValue({ error: null }),
    };

    const rollbackQuery = {
      eq: jest.fn().mockReturnThis(),
    };

    rollbackQuery.eq
      .mockReturnValueOnce(rollbackQuery)
      .mockResolvedValueOnce({
        error: { message: 'rollback unavailable' },
      });

    const update = jest
      .fn()
      .mockReturnValueOnce(softDeleteQuery)
      .mockReturnValueOnce(rollbackQuery);

    const client = {
      from: jest.fn((table: string) => {
        if (table === 'organizations') {
          return { update };
        }

        return {
          select:
            emptyDeleteDependencyQuery()
              .select,
        };
      }),
    };

    const auditService = {
      logDelete: jest.fn().mockRejectedValue(new Error('audit failed')),
    };

    const service = new OrganizationsService(
      { getClient: () => client } as any,
      auditService as any,
    );

    jest.spyOn(service, 'findOne').mockResolvedValue(before as any);

    await expect(
      service.delete('target-org', auditContext),
    ).rejects.toThrow(
      'Organization delete audit failed and compensation failed',
    );

    expect(update).toHaveBeenCalledTimes(2);
    expect(rollbackQuery.eq).toHaveBeenNthCalledWith(
      1,
      'id',
      'target-org',
    );
    expect(rollbackQuery.eq).toHaveBeenNthCalledWith(
      2,
      'deleted_at',
      expect.any(String),
    );
  });

});
