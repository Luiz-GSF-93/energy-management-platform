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

  function createRpcRow(overrides: Record<string, any> = {}) {
    return {
      organization_id: expect.any(String),
      organization_name: 'Created',
      organization_description: null,
      organization_created_at: '2026-09-22T10:00:00.000Z',
      organization_updated_at: '2026-09-22T10:00:00.000Z',
      organization_deleted_at: null,
      role_count: 4,
      ...overrides,
    };
  }

  function createRpcHarness(options: {
    rpcError?: any;
    rpcRows?: any;
    rpcThrow?: boolean;
    auditFailure?: boolean;
    rollbackError?: any;
  } = {}) {
    const rollback = {
      eq: jest.fn().mockReturnThis(),
      is: jest.fn().mockResolvedValue({
        error: options.rollbackError ?? null,
      }),
    };

    const remove = jest.fn(() => rollback);

    const rpc = options.rpcThrow
      ? jest.fn().mockRejectedValue(new Error('transport failure'))
      : jest.fn().mockImplementation(
          async (_name: string, args: any) => ({
            data:
              options.rpcRows !== undefined
                ? options.rpcRows
                : [
                    createRpcRow({
                      organization_id:
                        args.target_organization_id,
                      organization_name:
                        args.target_name,
                      organization_description:
                        args.target_description,
                    }),
                  ],
            error: options.rpcError ?? null,
          }),
        );

    const client = {
      rpc,
      from: jest.fn(() => ({
        delete: remove,
      })),
    };

    const auditService = {
      logCreate: options.auditFailure
        ? jest.fn().mockRejectedValue(
            new Error('audit failed'),
          )
        : jest.fn().mockResolvedValue(undefined),
    };

    const service = new OrganizationsService(
      { getClient: () => client } as any,
      auditService as any,
    );

    return {
      service,
      client,
      rpc,
      auditService,
      rollback,
      remove,
    };
  }

  it('A — CREATE provisions canonical RBAC before persistent audit', async () => {
    const h = createRpcHarness();

    const result = await h.service.create(
      {
        name: ' Created ',
        description: ' Description ',
      },
      auditContext,
    );

    expect(h.rpc).toHaveBeenCalledTimes(1);

    const [rpcName, rpcArgs] =
      h.rpc.mock.calls[0];

    expect(rpcName).toBe(
      'create_organization_with_canonical_rbac',
    );

    expect(rpcArgs).toEqual({
      target_organization_id: expect.any(String),
      target_name: 'Created',
      target_description: 'Description',
    });

    expect(result).toEqual({
      id: rpcArgs.target_organization_id,
      name: 'Created',
      description: 'Description',
      created_at: '2026-09-22T10:00:00.000Z',
      updated_at: '2026-09-22T10:00:00.000Z',
    });

    expect(
      h.auditService.logCreate,
    ).toHaveBeenCalledWith({
      userId: 'platform-user',
      organizationId:
        rpcArgs.target_organization_id,
      resourceType: 'organization',
      resourceId:
        rpcArgs.target_organization_id,
      after: result,
      ipAddress: '127.0.0.1',
      userAgent: 'f1.5.5-test',
    });
  });

  it.each([
    [
      'P3110',
      'Invalid organization creation request',
    ],
    [
      'P3111',
      'Organization identifier already exists',
    ],
    [
      'P3112',
      'Organization RBAC provisioning integrity failure',
    ],
  ])(
    'B — CREATE maps RPC error %s and does not audit',
    async (code, message) => {
      const h = createRpcHarness({
        rpcError: {
          code,
          message: 'database failure',
        },
      });

      await expect(
        h.service.create(
          { name: 'Created' },
          auditContext,
        ),
      ).rejects.toThrow(message);

      expect(
        h.auditService.logCreate,
      ).not.toHaveBeenCalled();

      expect(h.client.from).not.toHaveBeenCalled();
    },
  );

  it('B2 — CREATE fails closed on unknown RPC error', async () => {
    const h = createRpcHarness({
      rpcError: {
        code: 'XXXXX',
        message: 'unknown failure',
      },
    });

    await expect(
      h.service.create(
        { name: 'Created' },
        auditContext,
      ),
    ).rejects.toThrow(
      'Failed to create organization with canonical RBAC',
    );

    expect(
      h.auditService.logCreate,
    ).not.toHaveBeenCalled();
  });

  it('B3 — CREATE fails closed when RPC transport throws', async () => {
    const h = createRpcHarness({
      rpcThrow: true,
    });

    await expect(
      h.service.create(
        { name: 'Created' },
        auditContext,
      ),
    ).rejects.toThrow(
      'Failed to create organization with canonical RBAC',
    );

    expect(
      h.auditService.logCreate,
    ).not.toHaveBeenCalled();
  });

  it.each([
    null,
    [],
    [{}, {}],
  ])(
    'B4 — CREATE rejects malformed RPC row cardinality',
    async (rpcRows) => {
      const h = createRpcHarness({
        rpcRows,
      });

      await expect(
        h.service.create(
          { name: 'Created' },
          auditContext,
        ),
      ).rejects.toThrow(
        'Organization RBAC provisioning could not be confirmed',
      );

      expect(
        h.auditService.logCreate,
      ).not.toHaveBeenCalled();
    },
  );

  it('B5 — CREATE rejects incomplete canonical RBAC result', async () => {
    const h = createRpcHarness({
      rpcRows: [
        createRpcRow({
          organization_id: 'wrong-id',
          role_count: 3,
        }),
      ],
    });

    await expect(
      h.service.create(
        { name: 'Created' },
        auditContext,
      ),
    ).rejects.toThrow(
      'Organization RBAC provisioning integrity violation',
    );

    expect(
      h.auditService.logCreate,
    ).not.toHaveBeenCalled();
  });

  it('B6 — CREATE compensates guarded organization state when audit fails', async () => {
    const h = createRpcHarness({
      auditFailure: true,
    });

    await expect(
      h.service.create(
        { name: 'Created' },
        auditContext,
      ),
    ).rejects.toThrow('audit failed');

    expect(h.remove).toHaveBeenCalledTimes(1);

    expect(h.rollback.eq).toHaveBeenNthCalledWith(
      1,
      'id',
      expect.any(String),
    );

    expect(h.rollback.eq).toHaveBeenNthCalledWith(
      2,
      'updated_at',
      '2026-09-22T10:00:00.000Z',
    );

    expect(h.rollback.is).toHaveBeenCalledWith(
      'deleted_at',
      null,
    );
  });

  it('B7 — CREATE surfaces critical integrity failure when audit compensation fails', async () => {
    const h = createRpcHarness({
      auditFailure: true,
      rollbackError: {
        message: 'rollback unavailable',
      },
    });

    await expect(
      h.service.create(
        { name: 'Created' },
        auditContext,
      ),
    ).rejects.toThrow(
      'Organization audit failed and compensation failed',
    );
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
