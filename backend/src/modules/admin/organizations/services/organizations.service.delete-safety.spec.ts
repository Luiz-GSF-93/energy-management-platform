import {
  ConflictException,
} from '@nestjs/common';

import { OrganizationsService } from './organizations.service';

describe(
  'OrganizationsService — DELETE dependency safety',
  () => {
    const auditContext = {
      actorUserId: 'platform-user',
      ipAddress: '127.0.0.1',
      userAgent: 'p2.2d-test',
    };

    const organizationBefore = {
      id: 'target-org',
      name: 'Target',
      description: null,
      created_at:
        '2026-09-20T00:00:00.000Z',
      updated_at:
        '2026-09-20T00:00:00.000Z',
      deleted_at: null,
    };

    const dependencyTables = [
      'organization_members',
      'licenses',
      'customers',
      'consumer_units',
      'energy_contracts',
      'documents',
    ];

    function dependencyQuery(
      data: unknown[] | null,
      error: unknown = null,
    ) {
      const limit = jest.fn().mockResolvedValue({
        data,
        error,
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

    it.each(dependencyTables)(
      'blocks delete when %s has a dependency',
      async (blockingTable) => {
        const queries = new Map<
          string,
          ReturnType<typeof dependencyQuery>
        >();

        for (const table of dependencyTables) {
          queries.set(
            table,
            dependencyQuery(
              table === blockingTable
                ? [{ id: 'dependency-id' }]
                : [],
            ),
          );
        }

        const organizationUpdate =
          jest.fn();

        const client = {
          from: jest.fn((table: string) => {
            if (table === 'organizations') {
              return {
                update: organizationUpdate,
              };
            }

            const query = queries.get(table);

            if (!query) {
              throw new Error(
                `Unexpected table ${table}`,
              );
            }

            return {
              select: query.select,
            };
          }),
        };

        const auditService = {
          logDelete:
            jest.fn().mockResolvedValue(
              undefined,
            ),
        };

        const service =
          new OrganizationsService(
            {
              getClient: () => client,
            } as any,
            auditService as any,
          );

        jest
          .spyOn(service, 'findOne')
          .mockResolvedValue(
            organizationBefore as any,
          );

        await expect(
          service.delete(
            'target-org',
            auditContext,
          ),
        ).rejects.toBeInstanceOf(
          ConflictException,
        );

        expect(
          organizationUpdate,
        ).not.toHaveBeenCalled();

        expect(
          auditService.logDelete,
        ).not.toHaveBeenCalled();
      },
    );

    it(
      'fails closed when dependency resolution fails',
      async () => {
        const organizationUpdate =
          jest.fn();

        const failed =
          dependencyQuery(
            null,
            {
              message:
                'dependency query failed',
            },
          );

        const client = {
          from: jest.fn((table: string) => {
            if (table === 'organizations') {
              return {
                update: organizationUpdate,
              };
            }

            if (
              table ===
              'organization_members'
            ) {
              return {
                select: failed.select,
              };
            }

            throw new Error(
              `Unexpected table ${table}`,
            );
          }),
        };

        const auditService = {
          logDelete:
            jest.fn().mockResolvedValue(
              undefined,
            ),
        };

        const service =
          new OrganizationsService(
            {
              getClient: () => client,
            } as any,
            auditService as any,
          );

        jest
          .spyOn(service, 'findOne')
          .mockResolvedValue(
            organizationBefore as any,
          );

        await expect(
          service.delete(
            'target-org',
            auditContext,
          ),
        ).rejects.toThrow(
          'Unable to verify organization dependencies: organization_members',
        );

        expect(
          organizationUpdate,
        ).not.toHaveBeenCalled();

        expect(
          auditService.logDelete,
        ).not.toHaveBeenCalled();
      },
    );

    it(
      'allows soft-delete when all dependency checks are empty',
      async () => {
        const queries = new Map<
          string,
          ReturnType<typeof dependencyQuery>
        >();

        for (const table of dependencyTables) {
          queries.set(
            table,
            dependencyQuery([]),
          );
        }

        const softDeleteQuery = {
          eq: jest.fn().mockReturnThis(),
          is: jest.fn().mockResolvedValue({
            error: null,
          }),
        };

        const update = jest.fn(
          () => softDeleteQuery,
        );

        const client = {
          from: jest.fn((table: string) => {
            if (table === 'organizations') {
              return {
                update,
              };
            }

            const query = queries.get(table);

            if (!query) {
              throw new Error(
                `Unexpected table ${table}`,
              );
            }

            return {
              select: query.select,
            };
          }),
        };

        const auditService = {
          logDelete:
            jest.fn().mockResolvedValue(
              undefined,
            ),
        };

        const service =
          new OrganizationsService(
            {
              getClient: () => client,
            } as any,
            auditService as any,
          );

        jest
          .spyOn(service, 'findOne')
          .mockResolvedValue(
            organizationBefore as any,
          );

        await expect(
          service.delete(
            'target-org',
            auditContext,
          ),
        ).resolves.toBeUndefined();

        for (
          const table
          of dependencyTables
        ) {
          const query = queries.get(
            table,
          )!;

          expect(
            query.select,
          ).toHaveBeenCalledWith('id');

          expect(
            query.eq,
          ).toHaveBeenCalledWith(
            'organization_id',
            'target-org',
          );

          expect(
            query.limit,
          ).toHaveBeenCalledWith(1);
        }

        expect(update).toHaveBeenCalledTimes(
          1,
        );

        expect(
          softDeleteQuery.eq,
        ).toHaveBeenCalledWith(
          'id',
          'target-org',
        );

        expect(
          softDeleteQuery.is,
        ).toHaveBeenCalledWith(
          'deleted_at',
          null,
        );

        expect(
          auditService.logDelete,
        ).toHaveBeenCalledTimes(1);
      },
    );
  },
);
