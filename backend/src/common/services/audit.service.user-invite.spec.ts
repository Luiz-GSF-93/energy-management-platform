import { AuditService } from './audit.service';

describe('AuditService.logUserInvite — F1.2.4a', () => {
  const baseParams = {
    actorUserId: '11111111-1111-4111-8111-111111111111',
    organizationId: '22222222-2222-4222-8222-222222222222',
    targetUserId: '33333333-3333-4333-8333-333333333333',
    membershipId: '44444444-4444-4444-8444-444444444444',
    email: 'invitee@example.com',
    roleId: '55555555-5555-4555-8555-555555555555',
    affiliationType: 'external' as const,
    provisioningPath: 'new_identity' as const,
    ipAddress: '203.0.113.10',
    userAgent: 'F1.2.4a-test',
  };

  function createHarness(insertError: unknown = null) {
    const insert = jest.fn().mockResolvedValue({
      error: insertError,
    });

    const from = jest.fn((table: string) => {
      if (table !== 'audit_logs') {
        throw new Error(`Unexpected table: ${table}`);
      }

      return {
        insert,
      };
    });

    const getClient = jest.fn(() => ({
      from,
    }));

    const supabaseService = {
      getClient,
    };

    const service = new AuditService(supabaseService as any);

    return {
      service,
      insert,
      from,
      getClient,
    };
  }

  it('writes the exact persistent invite audit payload', async () => {
    const h = createHarness();

    await h.service.logUserInvite(baseParams);

    expect(h.getClient).toHaveBeenCalledTimes(1);
    expect(h.from).toHaveBeenCalledTimes(1);
    expect(h.from).toHaveBeenCalledWith('audit_logs');
    expect(h.insert).toHaveBeenCalledTimes(1);

    const payload = h.insert.mock.calls[0][0];

    expect(payload).toMatchObject({
      organization_id: baseParams.organizationId,
      user_id: baseParams.actorUserId,
      action: 'INVITE_ORGANIZATION_USER',
      resource_type: 'organization_membership',
      resource_id: baseParams.membershipId,
      changes: {
        before: null,
        after: {
          userId: baseParams.targetUserId,
          email: baseParams.email,
          roleId: baseParams.roleId,
          affiliationType: 'external',
          provisioningPath: 'new_identity',
        },
      },
      ip_address: baseParams.ipAddress,
      user_agent: baseParams.userAgent,
      status: 'success',
      error_message: null,
    });

    expect(typeof payload.created_at).toBe('string');
    expect(Number.isNaN(Date.parse(payload.created_at))).toBe(false);
  });

  it('supports existing identity path and null request metadata', async () => {
    const h = createHarness();

    await h.service.logUserInvite({
      ...baseParams,
      affiliationType: 'internal',
      provisioningPath: 'existing_identity',
      ipAddress: null,
      userAgent: null,
    });

    expect(h.insert).toHaveBeenCalledTimes(1);

    const payload = h.insert.mock.calls[0][0];

    expect(payload.changes.after).toEqual({
      userId: baseParams.targetUserId,
      email: baseParams.email,
      roleId: baseParams.roleId,
      affiliationType: 'internal',
      provisioningPath: 'existing_identity',
    });

    expect(payload.ip_address).toBeNull();
    expect(payload.user_agent).toBeNull();
  });

  it('fails closed when persistent audit insert fails', async () => {
    const h = createHarness({
      message: 'database unavailable',
    });

    await expect(
      h.service.logUserInvite(baseParams),
    ).rejects.toThrow('Audit insert failed');

    expect(h.insert).toHaveBeenCalledTimes(1);
  });

  it('performs exactly one insert and does not retry', async () => {
    const h = createHarness({
      message: 'insert rejected',
    });

    await expect(
      h.service.logUserInvite(baseParams),
    ).rejects.toThrow('Audit insert failed');

    expect(h.getClient).toHaveBeenCalledTimes(1);
    expect(h.from).toHaveBeenCalledTimes(1);
    expect(h.insert).toHaveBeenCalledTimes(1);
  });

  it('does not persist authentication secrets', async () => {
    const h = createHarness();

    await h.service.logUserInvite(baseParams);

    const payload = h.insert.mock.calls[0][0];
    const serialized = JSON.stringify(payload).toLowerCase();

    expect(serialized).not.toContain('password');
    expect(serialized).not.toContain('access_token');
    expect(serialized).not.toContain('refresh_token');
    expect(serialized).not.toContain('authorization');
    expect(serialized).not.toContain('bearer ');
  });
});
