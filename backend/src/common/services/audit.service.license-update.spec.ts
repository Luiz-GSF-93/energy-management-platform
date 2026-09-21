import { AuditService } from './audit.service';

describe('AuditService.logLicenseUpdate — F1.4i.3', () => {
  const before = {
    id: 'license-1',
    organization_id: 'org-1',
    status: 'ACTIVE',
    active: true,
    documents_limit: 100,
  };

  const after = {
    ...before,
    status: 'SUSPENDED',
    active: false,
  };

  const params = {
    actorUserId: 'user-1',
    organizationId: 'org-1',
    licenseId: 'license-1',
    before,
    after,
    ipAddress: '203.0.113.10',
    userAgent: 'F1.4i.3-test',
  };

  function createHarness(insertError: unknown = null) {
    const insert = jest.fn().mockResolvedValue({
      error: insertError,
    });

    const from = jest.fn((table: string) => {
      if (table !== 'audit_logs') {
        throw new Error(`Unexpected table: ${table}`);
      }

      return { insert };
    });

    const getClient = jest.fn(() => ({ from }));
    const service = new AuditService({ getClient } as any);

    return { service, insert, from };
  }

  it('writes exact persistent license update before/after audit', async () => {
    const h = createHarness();

    await h.service.logLicenseUpdate(params);

    expect(h.from).toHaveBeenCalledWith('audit_logs');
    expect(h.insert).toHaveBeenCalledTimes(1);

    const payload = h.insert.mock.calls[0][0];

    expect(payload).toMatchObject({
      organization_id: params.organizationId,
      user_id: params.actorUserId,
      action: 'UPDATE_LICENSE',
      resource_type: 'license',
      resource_id: params.licenseId,
      changes: {
        before,
        after,
      },
      ip_address: params.ipAddress,
      user_agent: params.userAgent,
      status: 'success',
      error_message: null,
    });

    expect(typeof payload.created_at).toBe('string');
    expect(Number.isNaN(Date.parse(payload.created_at))).toBe(false);
  });

  it('supports null request metadata', async () => {
    const h = createHarness();

    await h.service.logLicenseUpdate({
      ...params,
      ipAddress: null,
      userAgent: null,
    });

    const payload = h.insert.mock.calls[0][0];

    expect(payload.ip_address).toBeNull();
    expect(payload.user_agent).toBeNull();
  });

  it('fails closed when persistent audit insert fails', async () => {
    const h = createHarness({
      message: 'database unavailable',
    });

    await expect(
      h.service.logLicenseUpdate(params),
    ).rejects.toThrow('Audit insert failed');
  });
});
