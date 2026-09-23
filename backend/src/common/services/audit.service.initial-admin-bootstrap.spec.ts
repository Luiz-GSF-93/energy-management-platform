import { AuditService } from './audit.service';

describe(
  'AuditService.logInitialOrganizationAdminBootstrap',
  () => {
    function harness(
      insertError: unknown = null,
    ) {
      const insert = jest.fn().mockResolvedValue({
        data: null,
        error: insertError,
      });

      const from = jest.fn(
        (table: string) => {
          if (table !== 'audit_logs') {
            throw new Error(
              `Unexpected table ${table}`,
            );
          }

          return {
            insert,
          };
        },
      );

      const getClient = jest.fn(() => ({
        from,
      }));

      const service = new AuditService(
        {
          getClient,
        } as any,
      );

      return {
        service,
        from,
        insert,
      };
    }

    const params = {
      actorUserId:
        '11111111-1111-4111-8111-111111111111',
      organizationId: 'organization-1',
      targetUserId:
        '22222222-2222-4222-8222-222222222222',
      membershipId: 'membership-1',
      roleId: 'role-admin-org',
      affiliationType: 'external' as const,
      provisioningPath:
        'new_identity' as const,
      ipAddress: '127.0.0.1',
      userAgent: 'jest',
    };

    it(
      'persists bootstrap authority audit evidence',
      async () => {
        const h = harness();

        await h.service
          .logInitialOrganizationAdminBootstrap(
            params,
          );

        expect(h.from).toHaveBeenCalledWith(
          'audit_logs',
        );

        expect(h.insert).toHaveBeenCalledWith(
          expect.objectContaining({
            user_id: params.actorUserId,
            organization_id:
              params.organizationId,
            action: 'CREATE',
            resource_type:
              'organization_membership',
            resource_id:
              params.membershipId,
            before: null,
            ip_address:
              params.ipAddress,
            user_agent:
              params.userAgent,
            after: expect.objectContaining({
              user_id:
                params.targetUserId,
              organization_id:
                params.organizationId,
              membership_id:
                params.membershipId,
              role_id:
                params.roleId,
              role_name: 'admin_org',
              membership_status:
                'active',
              affiliation_type:
                'external',
              provisioning_path:
                'new_identity',
              bootstrap: true,
            }),
          }),
        );
      },
    );

    it(
      'fails closed when persistent audit fails',
      async () => {
        const h = harness({
          message: 'audit unavailable',
        });

        await expect(
          h.service
            .logInitialOrganizationAdminBootstrap(
              params,
            ),
        ).rejects.toThrow(
          'Initial organization administrator bootstrap audit failed',
        );
      },
    );

    it(
      'does not persist credential material',
      async () => {
        const h = harness();

        await h.service
          .logInitialOrganizationAdminBootstrap(
            params,
          );

        const payload =
          h.insert.mock.calls[0][0];

        const serialized =
          JSON.stringify(payload);

        expect(serialized).not.toContain(
          'password',
        );

        expect(serialized).not.toContain(
          'token',
        );

        expect(serialized).not.toContain(
          'credential',
        );
      },
    );
  },
);
