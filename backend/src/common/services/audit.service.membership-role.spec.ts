import { AuditService } from './audit.service';

describe('AuditService.logUserMembershipRoleChange', () => {
  const actorUserId = 'actor-user';
  const organizationId = 'org-a';
  const targetUserId = 'target-user';
  const membershipId = 'membership-a';
  const beforeRoleId = 'role-before';
  const afterRoleId = 'role-after';

  const createHarness = (insertError: any = null) => {
    const insert = jest.fn().mockResolvedValue({
      error: insertError,
    });

    const from = jest.fn((table: string) => {
      if (table !== 'audit_logs') {
        throw new Error(`Unexpected table ${table}`);
      }

      return {
        insert,
      };
    });

    const service = new AuditService({
      getClient: () => ({
        from,
      }),
    } as any);

    return {
      service,
      from,
      insert,
    };
  };

  it('A — persists membership role change with actor, tenant, target and before/after', async () => {
    const { service, from, insert } = createHarness();

    await service.logUserMembershipRoleChange({
      actorUserId,
      organizationId,
      targetUserId,
      membershipId,
      beforeRoleId,
      afterRoleId,
      ipAddress: '127.0.0.1',
      userAgent: 'f1.2.2a-test',
    });

    expect(from).toHaveBeenCalledTimes(1);
    expect(from).toHaveBeenCalledWith('audit_logs');
    expect(insert).toHaveBeenCalledTimes(1);

    const payload = insert.mock.calls[0][0];

    expect(payload).toEqual(
      expect.objectContaining({
        organization_id: organizationId,
        user_id: actorUserId,
        action: 'UPDATE_USER_MEMBERSHIP_ROLE',
        resource_type: 'organization_membership',
        resource_id: membershipId,
        ip_address: '127.0.0.1',
        user_agent: 'f1.2.2a-test',
        status: 'success',
        error_message: null,
      }),
    );

    expect(payload.id).toEqual(expect.any(String));
    expect(payload.created_at).toEqual(expect.any(String));

    expect(payload.changes).toEqual({
      before: {
        userId: targetUserId,
        roleId: beforeRoleId,
      },
      after: {
        userId: targetUserId,
        roleId: afterRoleId,
      },
    });
  });

  it('B — stores absent request origin metadata as null', async () => {
    const { service, insert } = createHarness();

    await service.logUserMembershipRoleChange({
      actorUserId,
      organizationId,
      targetUserId,
      membershipId,
      beforeRoleId,
      afterRoleId,
    });

    const payload = insert.mock.calls[0][0];

    expect(payload.ip_address).toBeNull();
    expect(payload.user_agent).toBeNull();
  });

  it('C — fails closed when persistent audit insert fails', async () => {
    const { service, insert } = createHarness({
      message: 'simulated audit failure',
    });

    await expect(
      service.logUserMembershipRoleChange({
        actorUserId,
        organizationId,
        targetUserId,
        membershipId,
        beforeRoleId,
        afterRoleId,
      }),
    ).rejects.toThrow('Audit insert failed');

    expect(insert).toHaveBeenCalledTimes(1);
  });

  it('D — never substitutes org_default for organization authority', async () => {
    const { service, insert } = createHarness();

    await service.logUserMembershipRoleChange({
      actorUserId,
      organizationId,
      targetUserId,
      membershipId,
      beforeRoleId,
      afterRoleId,
    });

    const payload = insert.mock.calls[0][0];

    expect(payload.organization_id).toBe(organizationId);
    expect(payload.organization_id).not.toBe('org_default');
  });
});
