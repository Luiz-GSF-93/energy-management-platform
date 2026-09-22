import { AuditService } from './audit.service';

describe('AuditService — organization mutation primitives', () => {
  const makeHarness = () => {
    const insert = jest.fn().mockResolvedValue({ error: null });
    const from = jest.fn((table: string) => {
      if (table !== 'audit_logs') {
        throw new Error(`Unexpected table ${table}`);
      }

      return { insert };
    });

    const service = new AuditService({
      getClient: () => ({ from }),
    } as any);

    return { service, from, insert };
  };

  it('A — logCreate persists CREATE with before null and created state', async () => {
    const h = makeHarness();

    const after = {
      id: 'target-org',
      name: 'Target Organization',
      deleted_at: null,
    };

    await h.service.logCreate({
      userId: 'platform-user',
      organizationId: 'target-org',
      resourceType: 'organization',
      resourceId: 'target-org',
      after,
      ipAddress: '127.0.0.1',
      userAgent: 'f1.5.5-test',
    });

    expect(h.from).toHaveBeenCalledWith('audit_logs');
    expect(h.insert).toHaveBeenCalledTimes(1);

    expect(h.insert).toHaveBeenCalledWith([
      expect.objectContaining({
        organization_id: 'target-org',
        user_id: 'platform-user',
        action: 'CREATE',
        resource_type: 'organization',
        resource_id: 'target-org',
        changes: {
          before: null,
          after,
        },
        ip_address: '127.0.0.1',
        user_agent: 'f1.5.5-test',
        status: 'success',
        error_message: null,
      }),
    ]);
  });

  it('B — logUpdate persists UPDATE with before and after states', async () => {
    const h = makeHarness();

    const before = {
      id: 'target-org',
      name: 'Before',
    };

    const after = {
      id: 'target-org',
      name: 'After',
    };

    await h.service.logUpdate({
      userId: 'platform-user',
      organizationId: 'target-org',
      resourceType: 'organization',
      resourceId: 'target-org',
      before,
      after,
      ipAddress: '127.0.0.1',
      userAgent: 'f1.5.5-test',
    });

    expect(h.from).toHaveBeenCalledWith('audit_logs');
    expect(h.insert).toHaveBeenCalledTimes(1);

    expect(h.insert).toHaveBeenCalledWith([
      expect.objectContaining({
        organization_id: 'target-org',
        user_id: 'platform-user',
        action: 'UPDATE',
        resource_type: 'organization',
        resource_id: 'target-org',
        changes: {
          before,
          after,
        },
        ip_address: '127.0.0.1',
        user_agent: 'f1.5.5-test',
        status: 'success',
        error_message: null,
      }),
    ]);
  });

  it('C — logCreate fails closed when persistent audit insert fails', async () => {
    const h = makeHarness();

    h.insert.mockResolvedValueOnce({
      error: { message: 'audit unavailable' },
    });

    await expect(
      h.service.logCreate({
        userId: 'platform-user',
        organizationId: 'target-org',
        resourceType: 'organization',
        resourceId: 'target-org',
        after: { id: 'target-org' },
      }),
    ).rejects.toThrow('Audit logging failed');
  });

  it('D — logUpdate fails closed when persistent audit insert fails', async () => {
    const h = makeHarness();

    h.insert.mockResolvedValueOnce({
      error: { message: 'audit unavailable' },
    });

    await expect(
      h.service.logUpdate({
        userId: 'platform-user',
        organizationId: 'target-org',
        resourceType: 'organization',
        resourceId: 'target-org',
        before: { id: 'target-org', name: 'Before' },
        after: { id: 'target-org', name: 'After' },
      }),
    ).rejects.toThrow('Audit logging failed');
  });
});
