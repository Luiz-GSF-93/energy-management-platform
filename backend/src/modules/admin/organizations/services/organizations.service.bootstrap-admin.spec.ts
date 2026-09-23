import {
  ConflictException,
  InternalServerErrorException,
} from '@nestjs/common';

import { OrganizationsService } from './organizations.service';

describe(
  'OrganizationsService — initial admin bootstrap',
  () => {
    const organizationId = 'target-org';
    const userId =
      '11111111-1111-4111-8111-111111111111';
    const roleId = 'admin-org-role';
    const membershipId = 'membership-1';

    const dto = {
      email: 'admin@example.com',
      name: 'Initial Admin',
      affiliationType: 'internal' as const,
    };

    const auditContext = {
      actorUserId: 'platform-user',
      ipAddress: '127.0.0.1',
      userAgent: 'bootstrap-test',
    };

    function eqChain(
      result: {
        data: unknown;
        error: unknown;
      },
      withIs = false,
    ) {
      const chain: any = {};

      chain.eq = jest.fn(
        () => chain,
      );

      chain.is = jest.fn(
        () => Promise.resolve(result),
      );

      chain.then = (
        resolve: (
          value: typeof result,
        ) => unknown,
        reject?: (
          reason: unknown,
        ) => unknown,
      ) =>
        Promise.resolve(result).then(
          resolve,
          reject,
        );

      if (!withIs) {
        delete chain.is;
      }

      return chain;
    }

    function existingIdentityHarness(
      options: {
        rpcError?: unknown;
        profileAffiliation?:
          | 'internal'
          | 'external';
        authUserPresent?: boolean;
      } = {},
    ) {
      const organizationQuery =
        eqChain(
          {
            data: [
              {
                id: organizationId,
              },
            ],
            error: null,
          },
          true,
        );

      const roleQuery =
        eqChain({
          data: [
            {
              id: roleId,
              name: 'admin_org',
              organization_id:
                organizationId,
              scope: 'organization',
            },
          ],
          error: null,
        });

      const profileQuery =
        eqChain({
          data: [
            {
              user_id: userId,
              email: dto.email,
              name: dto.name,
              organization_id:
                organizationId,
              affiliation_type:
                options.profileAffiliation ??
                'internal',
            },
          ],
          error: null,
        });

      const from = jest.fn(
        (table: string) => {
          if (table === 'organizations') {
            return {
              select: jest.fn(
                () => organizationQuery,
              ),
            };
          }

          if (table === 'roles') {
            return {
              select: jest.fn(
                () => roleQuery,
              ),
            };
          }

          if (table === 'user_profiles') {
            return {
              select: jest.fn(
                () => profileQuery,
              ),
            };
          }

          throw new Error(
            `Unexpected table ${table}`,
          );
        },
      );

      const rpc = jest
        .fn()
        .mockResolvedValue({
          data: options.rpcError
            ? null
            : [
                {
                  membership_id:
                    membershipId,
                  organization_id:
                    organizationId,
                  user_id:
                    userId,
                  role_id:
                    roleId,
                  membership_status:
                    'active',
                },
              ],
          error:
            options.rpcError ?? null,
        });

      const getUserById = jest
        .fn()
        .mockResolvedValue({
          data: {
            user:
              options.authUserPresent === false
                ? null
                : {
                    id: userId,
                    email: dto.email,
                  },
          },
          error: null,
        });

      const deleteUser =
        jest.fn();

      const listUsers =
        jest.fn();

      const inviteUserByEmail =
        jest.fn();

      const authClient = {
        auth: {
          admin: {
            getUserById,
            deleteUser,
            listUsers,
            inviteUserByEmail,
          },
        },
      };

      const auditService = {
        logInitialOrganizationAdminBootstrap:
          jest
            .fn()
            .mockResolvedValue(undefined),
      };

      const service =
        new OrganizationsService(
          {
            getClient: () => ({
              from,
              rpc,
            }),
            createAuthClient:
              () => authClient,
          } as any,
          auditService as any,
        );

      return {
        service,
        from,
        rpc,
        getUserById,
        deleteUser,
        listUsers,
        inviteUserByEmail,
        auditService,
      };
    }

    it(
      'reuses existing identity/profile and bootstraps membership through RPC',
      async () => {
        const h =
          existingIdentityHarness();

        await expect(
          h.service.bootstrapAdmin(
            organizationId,
            dto,
            auditContext,
          ),
        ).resolves.toEqual({
          userId,
          membershipId,
          roleId,
          membershipStatus:
            'active',
          provisioningPath:
            'existing_identity',
        });

        expect(h.rpc)
          .toHaveBeenCalledTimes(1);

        expect(h.rpc)
          .toHaveBeenCalledWith(
            'bootstrap_initial_organization_admin',
            {
              target_organization_id:
                organizationId,
              target_user_id:
                userId,
            },
          );

        expect(
          h.auditService
            .logInitialOrganizationAdminBootstrap,
        ).toHaveBeenCalledWith({
          actorUserId:
            auditContext.actorUserId,
          organizationId,
          targetUserId:
            userId,
          membershipId,
          roleId,
          affiliationType:
            'internal',
          provisioningPath:
            'existing_identity',
          ipAddress:
            auditContext.ipAddress,
          userAgent:
            auditContext.userAgent,
        });

        expect(
          h.inviteUserByEmail,
        ).not.toHaveBeenCalled();

        expect(
          h.deleteUser,
        ).not.toHaveBeenCalled();
      },
    );

    it(
      'rejects affiliation mismatch before RPC without rewriting profile',
      async () => {
        const h =
          existingIdentityHarness({
            profileAffiliation:
              'external',
          });

        await expect(
          h.service.bootstrapAdmin(
            organizationId,
            dto,
            auditContext,
          ),
        ).rejects.toBeInstanceOf(
          ConflictException,
        );

        expect(h.rpc)
          .not.toHaveBeenCalled();

        expect(
          h.auditService
            .logInitialOrganizationAdminBootstrap,
        ).not.toHaveBeenCalled();

        expect(
          h.deleteUser,
        ).not.toHaveBeenCalled();
      },
    );

    it(
      'fails closed when profile identity cannot be resolved',
      async () => {
        const h =
          existingIdentityHarness({
            authUserPresent: false,
          });

        await expect(
          h.service.bootstrapAdmin(
            organizationId,
            dto,
            auditContext,
          ),
        ).rejects.toBeInstanceOf(
          InternalServerErrorException,
        );

        expect(h.rpc)
          .not.toHaveBeenCalled();

        expect(
          h.auditService
            .logInitialOrganizationAdminBootstrap,
        ).not.toHaveBeenCalled();
      },
    );

    it.each([
      [
        'P3010',
        'Organization already has an active administrator',
      ],
      [
        'P3011',
        'User already has a membership in this organization',
      ],
      [
        'P3012',
        'Organization membership was created concurrently',
      ],
    ])(
      'maps %s to domain conflict',
      async (
        code,
        message,
      ) => {
        const h =
          existingIdentityHarness({
            rpcError: {
              code,
              message:
                'database conflict',
            },
          });

        await expect(
          h.service.bootstrapAdmin(
            organizationId,
            dto,
            auditContext,
          ),
        ).rejects.toThrow(
          message,
        );

        await expect(
          h.service.bootstrapAdmin(
            organizationId,
            dto,
            auditContext,
          ),
        ).rejects.toBeInstanceOf(
          ConflictException,
        );

        expect(
          h.auditService
            .logInitialOrganizationAdminBootstrap,
        ).not.toHaveBeenCalled();

        expect(
          h.deleteUser,
        ).not.toHaveBeenCalled();
      },
    );

    it.each([
      'P3003',
      'P3004',
      'P3005',
    ])(
      'fails closed for structural RPC error %s',
      async (code) => {
        const h =
          existingIdentityHarness({
            rpcError: {
              code,
              message:
                'database integrity failure',
            },
          });

        await expect(
          h.service.bootstrapAdmin(
            organizationId,
            dto,
            auditContext,
          ),
        ).rejects.toThrow(
          'Bootstrap database integrity failure',
        );

        expect(
          h.auditService
            .logInitialOrganizationAdminBootstrap,
        ).not.toHaveBeenCalled();

        expect(
          h.deleteUser,
        ).not.toHaveBeenCalled();
      },
    );

    function newIdentityHarness(
      options: {
        auditFailure?: boolean;
        membershipRollbackFailure?: boolean;
        rpcIntegrityFailure?: boolean;
      } = {},
    ) {
      const newUserId =
        '22222222-2222-4222-8222-222222222222';

      const organizationResult = {
        data: [
          {
            id: organizationId,
          },
        ],
        error: null,
      };

      const roleResult = {
        data: [
          {
            id: roleId,
            name: 'admin_org',
            organization_id:
              organizationId,
            scope: 'organization',
          },
        ],
        error: null,
      };

      const profileLookupResult = {
        data: [],
        error: null,
      };

      function selectEqQuery(
        result: {
          data: unknown;
          error: unknown;
        },
        useIs = false,
      ) {
        const chain: any = {};

        chain.eq = jest.fn(
          () => chain,
        );

        chain.is = jest.fn(
          () => Promise.resolve(result),
        );

        chain.then = (
          resolve: (
            value: typeof result,
          ) => unknown,
          reject?: (
            reason: unknown,
          ) => unknown,
        ) =>
          Promise.resolve(result).then(
            resolve,
            reject,
          );

        if (!useIs) {
          delete chain.is;
        }

        return chain;
      }

      const organizationQuery =
        selectEqQuery(
          organizationResult,
          true,
        );

      const roleQuery =
        selectEqQuery(
          roleResult,
        );

      const profileLookupQuery =
        selectEqQuery(
          profileLookupResult,
        );

      const profileInsertSelect =
        jest.fn().mockResolvedValue({
          data: [
            {
              user_id: newUserId,
              email: dto.email,
              organization_id:
                organizationId,
              affiliation_type:
                dto.affiliationType,
            },
          ],
          error: null,
        });

      const profileInsert =
        jest.fn(() => ({
          select:
            profileInsertSelect,
        }));

      const profileDeleteSelect =
        jest.fn().mockResolvedValue({
          data: [
            {
              user_id: newUserId,
              email: dto.email,
              organization_id:
                organizationId,
              affiliation_type:
                dto.affiliationType,
            },
          ],
          error: null,
        });

      const profileDeleteQuery: any = {
        eq: jest.fn(
          () => profileDeleteQuery,
        ),
        select:
          profileDeleteSelect,
      };

      const profileDelete =
        jest.fn(
          () => profileDeleteQuery,
        );

      const membershipDeleteSelect =
        jest.fn().mockResolvedValue(
          options.membershipRollbackFailure
            ? {
                data: [],
                error: {
                  message:
                    'membership rollback failed',
                },
              }
            : {
                data: [
                  {
                    id: membershipId,
                    user_id:
                      newUserId,
                    organization_id:
                      organizationId,
                    role_id:
                      roleId,
                    status:
                      'active',
                  },
                ],
                error: null,
              },
        );

      const membershipDeleteQuery: any = {
        eq: jest.fn(
          () => membershipDeleteQuery,
        ),
        select:
          membershipDeleteSelect,
      };

      const membershipDelete =
        jest.fn(
          () => membershipDeleteQuery,
        );

      let profileFromCalls = 0;

      const from = jest.fn(
        (table: string) => {
          if (table === 'organizations') {
            return {
              select: jest.fn(
                () => organizationQuery,
              ),
            };
          }

          if (table === 'roles') {
            return {
              select: jest.fn(
                () => roleQuery,
              ),
            };
          }

          if (table === 'user_profiles') {
            profileFromCalls += 1;

            if (profileFromCalls === 1) {
              return {
                select: jest.fn(
                  () => profileLookupQuery,
                ),
              };
            }

            if (profileFromCalls === 2) {
              return {
                insert:
                  profileInsert,
              };
            }

            return {
              delete:
                profileDelete,
            };
          }

          if (
            table ===
            'organization_members'
          ) {
            return {
              delete:
                membershipDelete,
            };
          }

          throw new Error(
            `Unexpected table ${table}`,
          );
        },
      );

      const rpc = jest
        .fn()
        .mockResolvedValue({
          data: [
            options.rpcIntegrityFailure
              ? {
                  membership_id:
                    membershipId,
                  organization_id:
                    'wrong-org',
                  user_id:
                    newUserId,
                  role_id:
                    roleId,
                  membership_status:
                    'active',
                }
              : {
                  membership_id:
                    membershipId,
                  organization_id:
                    organizationId,
                  user_id:
                    newUserId,
                  role_id:
                    roleId,
                  membership_status:
                    'active',
                },
          ],
          error: null,
        });

      const listUsers =
        jest.fn().mockResolvedValue({
          data: {
            users: [],
            lastPage: 1,
          },
          error: null,
        });

      const inviteUserByEmail =
        jest.fn().mockResolvedValue({
          data: {
            user: {
              id: newUserId,
              email: dto.email,
            },
          },
          error: null,
        });

      const deleteUser =
        jest.fn().mockResolvedValue({
          data: {},
          error: null,
        });

      const authClient = {
        auth: {
          admin: {
            listUsers,
            inviteUserByEmail,
            deleteUser,
            getUserById:
              jest.fn(),
          },
        },
      };

      const auditService = {
        logInitialOrganizationAdminBootstrap:
          options.auditFailure
            ? jest
                .fn()
                .mockRejectedValue(
                  new Error(
                    'audit failed',
                  ),
                )
            : jest
                .fn()
                .mockResolvedValue(
                  undefined,
                ),
      };

      const service =
        new OrganizationsService(
          {
            getClient: () => ({
              from,
              rpc,
            }),
            createAuthClient:
              () => authClient,
          } as any,
          auditService as any,
        );

      return {
        service,
        newUserId,
        from,
        rpc,
        listUsers,
        inviteUserByEmail,
        deleteUser,
        profileInsert,
        profileDelete,
        profileDeleteQuery,
        membershipDelete,
        membershipDeleteQuery,
        auditService,
      };
    }

    it(
      'creates a new identity/profile and bootstraps membership',
      async () => {
        const h =
          newIdentityHarness();

        await expect(
          h.service.bootstrapAdmin(
            organizationId,
            dto,
            auditContext,
          ),
        ).resolves.toEqual({
          userId:
            h.newUserId,
          membershipId,
          roleId,
          membershipStatus:
            'active',
          provisioningPath:
            'new_identity',
        });

        expect(
          h.listUsers,
        ).toHaveBeenCalledWith({
          page: 1,
          perPage: 100,
        });

        expect(
          h.inviteUserByEmail,
        ).toHaveBeenCalledTimes(1);

        expect(
          h.profileInsert,
        ).toHaveBeenCalledTimes(1);

        expect(h.rpc)
          .toHaveBeenCalledWith(
            'bootstrap_initial_organization_admin',
            {
              target_organization_id:
                organizationId,
              target_user_id:
                h.newUserId,
            },
          );

        expect(
          h.auditService
            .logInitialOrganizationAdminBootstrap,
        ).toHaveBeenCalledTimes(1);

        expect(
          h.membershipDelete,
        ).not.toHaveBeenCalled();

        expect(
          h.profileDelete,
        ).not.toHaveBeenCalled();

        expect(
          h.deleteUser,
        ).not.toHaveBeenCalled();
      },
    );

    it(
      'compensates new authority in membership profile identity order when audit fails',
      async () => {
        const h =
          newIdentityHarness({
            auditFailure: true,
          });

        const order: string[] = [];

        h.membershipDelete.mockImplementation(
          () => {
            order.push(
              'membership',
            );

            return h
              .membershipDeleteQuery;
          },
        );

        h.profileDelete.mockImplementation(
          () => {
            order.push(
              'profile',
            );

            return h
              .profileDeleteQuery;
          },
        );

        h.deleteUser.mockImplementation(
          async () => {
            order.push(
              'identity',
            );

            return {
              data: {},
              error: null,
            };
          },
        );

        await expect(
          h.service.bootstrapAdmin(
            organizationId,
            dto,
            auditContext,
          ),
        ).rejects.toThrow(
          'Bootstrap audit failed; provisioning was reverted',
        );

        expect(order).toEqual([
          'membership',
          'profile',
          'identity',
        ]);

        expect(
          h.membershipDeleteQuery.eq,
        ).toHaveBeenCalledWith(
          'id',
          membershipId,
        );

        expect(
          h.membershipDeleteQuery.eq,
        ).toHaveBeenCalledWith(
          'user_id',
          h.newUserId,
        );

        expect(
          h.membershipDeleteQuery.eq,
        ).toHaveBeenCalledWith(
          'organization_id',
          organizationId,
        );

        expect(
          h.membershipDeleteQuery.eq,
        ).toHaveBeenCalledWith(
          'role_id',
          roleId,
        );

        expect(
          h.membershipDeleteQuery.eq,
        ).toHaveBeenCalledWith(
          'status',
          'active',
        );

        expect(
          h.profileDeleteQuery.eq,
        ).toHaveBeenCalledWith(
          'user_id',
          h.newUserId,
        );

        expect(
          h.profileDeleteQuery.eq,
        ).toHaveBeenCalledWith(
          'organization_id',
          organizationId,
        );

        expect(
          h.deleteUser,
        ).toHaveBeenCalledWith(
          h.newUserId,
        );
      },
    );

    it(
      'does not remove identity/profile when membership compensation fails',
      async () => {
        const h =
          newIdentityHarness({
            auditFailure: true,
            membershipRollbackFailure:
              true,
          });

        await expect(
          h.service.bootstrapAdmin(
            organizationId,
            dto,
            auditContext,
          ),
        ).rejects.toThrow(
          'Bootstrap audit failed and membership compensation failed',
        );

        expect(
          h.membershipDelete,
        ).toHaveBeenCalledTimes(1);

        expect(
          h.profileDelete,
        ).not.toHaveBeenCalled();

        expect(
          h.deleteUser,
        ).not.toHaveBeenCalled();
      },
    );

    it(
      'compensates only owned identity/profile when RPC result cannot prove membership ownership',
      async () => {
        const h =
          newIdentityHarness({
            rpcIntegrityFailure:
              true,
          });

        await expect(
          h.service.bootstrapAdmin(
            organizationId,
            dto,
            auditContext,
          ),
        ).rejects.toThrow(
          'Bootstrap membership integrity violation',
        );

        expect(
          h.membershipDelete,
        ).not.toHaveBeenCalled();

        expect(
          h.profileDelete,
        ).toHaveBeenCalledTimes(1);

        expect(
          h.deleteUser,
        ).toHaveBeenCalledWith(
          h.newUserId,
        );

        expect(
          h.auditService
            .logInitialOrganizationAdminBootstrap,
        ).not.toHaveBeenCalled();
      },
    );

  },
);
