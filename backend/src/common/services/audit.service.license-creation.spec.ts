import { AuditService } from './audit.service';

describe('AuditService.logLicenseCreation — F1.4i.2', () => {
  const after = {
    id: 'license-1',
    organization_id: 'org-1',
    license_type: 'foundation',
    documents_limit: 100,
    documents_used: 0,
    renewal_date: '2027-01-01',
    start_date: '2026-09-21',
    end_date: null,
    status: 'ACTIVE',
    active: true,
  };

  const params = {
    actorUserId: 'user-1',
    organizationId: 'org-1',
    licenseId: 'license-1',
    after,
    ipAddress: '203.0.113.10',
    userAgent: 'F1.4i.2-test',
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

    return { service, insert, from, getClient };
  }

  it('writes the exact persistent license creation audit payload', async () => {
    const h = createHarness();

    await h.service.logLicenseCreation(params);

    expect(h.from).toHaveBeenCalledWith('audit_logs');
    expect(h.insert).toHaveBeenCalledTimes(1);

    const payload = h.insert.mock.calls[0][0];

    expect(payload).toMatchObject({
      organization_id: params.organizationId,
      user_id: params.actorUserId,
      action: 'CREATE_LICENSE',
      resource_type: 'license',
      resource_id: params.licenseId,
      changes: {
        before: null,
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

    await h.service.logLicenseCreation({
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
      h.service.logLicenseCreation(params),
    ).rejects.toThrow('Audit insert failed');
  });
});
