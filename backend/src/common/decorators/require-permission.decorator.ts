import { SetMetadata } from '@nestjs/common';

export const PERMISSIONS_KEY = 'permissions_required';

export const RequirePermission = (permissions: string[]) =>
  SetMetadata(PERMISSIONS_KEY, permissions);
