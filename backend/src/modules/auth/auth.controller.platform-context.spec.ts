import 'reflect-metadata';

import { AuthController } from './auth.controller';
import {
  PLATFORM_SCOPE_KEY,
} from '../../common/decorators/platform-scope.decorator';

describe(
  'AuthController platform context',
  () => {
    const authService = {} as any;

    const controller =
      new AuthController(authService);

    it(
      'marks platform-context as platform scoped',
      () => {
        const metadata = Reflect.getMetadata(
          PLATFORM_SCOPE_KEY,
          AuthController.prototype
            .getPlatformContext,
        );

        expect(metadata).toBe(true);
      },
    );

    it(
      'serializes the resolved global access context',
      async () => {
        const result =
          await controller.getPlatformContext({
            scope: 'global',
            userId: 'user-1',
            email: 'admin@example.invalid',
            role: 'admin_platform',
            roleId: 'role-1',
            permissions: [
              'permission-1',
              'permission-2',
            ],
          });

        expect(result).toEqual({
          scope: 'global',
          user: {
            id: 'user-1',
            email: 'admin@example.invalid',
          },
          role: 'admin_platform',
          roleId: 'role-1',
          permissions: [
            'permission-1',
            'permission-2',
          ],
        });

        expect(
          'organizationId' in result,
        ).toBe(false);
      },
    );
  },
);
