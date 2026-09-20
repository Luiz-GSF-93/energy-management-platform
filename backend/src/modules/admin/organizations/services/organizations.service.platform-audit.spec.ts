import { OrganizationsService } from './organizations.service';

describe('OrganizationsService — platform organization audit contract', () => {
  it('A — DELETE audits target organization and authenticated actor', async () => {
    const targetOrganizationId = 'target-org';
    const actorUserId = 'platform-user';

    const organizationBefore = {
      id: targetOrganizationId,
      name: 'Target Organization',
      description: null,
      created_at: '2026-09-20T00:00:00.000Z',
      updated_at: '2026-09-20T00:00:00.000Z',
      deleted_at: null,
    };

    const updateQuery = {
      eq: jest.fn().mockReturnThis(),
      is: jest.fn().mockResolvedValue({
        error: null,
      }),
    };

    const client = {
      from: jest.fn((table: string) => {
        if (table !== 'organizations') {
          throw new Error(`Unexpected table ${table}`);
        }

        return {
          update: jest.fn(() => updateQuery),
        };
      }),
    };

    const auditService = {
      logDelete: jest.fn().mockResolvedValue(undefined),
    };

    const service = new OrganizationsService(
      {
        getClient: () => client,
      } as any,
      auditService as any,
    );

    jest
      .spyOn(service, 'findOne')
      .mockResolvedValue(organizationBefore as any);

    await service.delete(targetOrganizationId, {
      actorUserId,
      ipAddress: '127.0.0.1',
      userAgent: 'phase-5.7-test',
    });

    expect(auditService.logDelete).toHaveBeenCalledTimes(1);

    expect(auditService.logDelete).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: actorUserId,
        organizationId: targetOrganizationId,
        resourceType: 'organization',
        resourceId: targetOrganizationId,
        before: organizationBefore,
        ipAddress: '127.0.0.1',
        userAgent: 'phase-5.7-test',
      }),
    );

    const auditPayload = auditService.logDelete.mock.calls[0][0];

    expect(auditPayload.organizationId).not.toBe('org_default');
    expect(auditPayload.after).toEqual(
      expect.objectContaining({
        id: targetOrganizationId,
      }),
    );
    expect(auditPayload.after.deleted_at).toEqual(
      expect.any(String),
    );
  });
});
