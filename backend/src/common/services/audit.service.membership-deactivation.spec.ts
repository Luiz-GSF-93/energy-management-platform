import { AuditService } from './audit.service';

describe('AuditService.logUserMembershipDeactivation — F1.2.3a', () => {
  const actorUserId = 'actor-user';
  const targetUserId = 'target-user';
  const organizationId = 'org-a';
  const membershipId = 'membership-a';

  const makeHarness = (insertResult: {
    error: null | { message: string };
  } = { error: null }) => {
    const insert = jest.fn().mockResolvedValue(insertResult);
    const from = jest.fn().mockReturnValue({ insert });

    const supabaseService = {
      getClient: jest.fn().mockReturnValue({ from }),
    };

    const service = new AuditService(supabaseService as any);

    return {
      service,
      supabaseService,
      from,
      insert,
    };
  };

  const params = {
    actorUserId,
    organizationId,
    targetUserId,
    membershipId,
    beforeStatus: 'active' as const,
    afterStatus: 'inactive' as const,
    ipAddress: '127.0.0.1',
    userAgent: 'f1.2.3a-test',
  };

  it('A — persists the exact organization membership deactivation audit contract', async () => {
    const { service, supabaseService, from, insert } = makeHarness();

    await service.logUserMembershipDeactivation(params);

    expect(supabaseService.getClient).toHaveBeenCalledTimes(1);
    expect(from).toHaveBeenCalledTimes(1);
    expect(from).toHaveBeenCalledWith('audit_logs');
    expect(insert).toHaveBeenCalledTimes(1);

    const payload = insert.mock.calls[0][0];

    expect(payload).toEqual(
      expect.objectContaining({
        organization_id: organizationId,
        user_id: actorUserId,
        action: 'DEACTIVATE_USER_MEMBERSHIP',
        resource_type: 'organization_membership',
        resource_id: membershipId,
        changes: {
          before: {
            userId: targetUserId,
            status: 'active',
          },
          after: {
            userId: targetUserId,
            status: 'inactive',
          },
        },
        ip_address: '127.0.0.1',
        user_agent: 'f1.2.3a-test',
        status: 'success',
        error_message: null,
      }),
    );

    expect(typeof payload.id).toBe('string');
    expect(payload.id.length).toBeGreaterThan(0);

    expect(typeof payload.created_at).toBe('string');
    expect(Number.isNaN(Date.parse(payload.created_at))).toBe(false);
  });

  it('B — stores absent IP and user-agent as null', async () => {
    const { service, insert } = makeHarness();

    await service.logUserMembershipDeactivation({
      actorUserId,
      organizationId,
      targetUserId,
      membershipId,
      beforeStatus: 'active',
      afterStatus: 'inactive',
    });

    const payload = insert.mock.calls[0][0];

    expect(payload.ip_address).toBeNull();
    expect(payload.user_agent).toBeNull();
  });

  it('C — fails closed when persistent audit insert fails', async () => {
    const { service, insert } = makeHarness({
      error: { message: 'audit unavailable' },
    });

    await expect(
      service.logUserMembershipDeactivation(params),
    ).rejects.toThrow('Audit insert failed');

    expect(insert).toHaveBeenCalledTimes(1);
  });

  it('D — performs exactly one persistent insert and does not retry on failure', async () => {
    const { service, supabaseService, from, insert } = makeHarness({
      error: { message: 'persistent failure' },
    });

    await expect(
      service.logUserMembershipDeactivation(params),
    ).rejects.toThrow('Audit insert failed');

    expect(supabaseService.getClient).toHaveBeenCalledTimes(1);
    expect(from).toHaveBeenCalledTimes(1);
    expect(from).toHaveBeenCalledWith('audit_logs');
    expect(insert).toHaveBeenCalledTimes(1);
  });
});
