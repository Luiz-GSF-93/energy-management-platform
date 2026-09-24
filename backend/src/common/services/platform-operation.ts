import { ForbiddenException } from '@nestjs/common';
import { TenantContext } from '../interfaces/tenant-context.interface';

export const PLATFORM_OPERATE_PERMISSION = '5f6e284b-07b2-4e3c-aec3-a331c071719a';
export const PLATFORM_SESSION_HEADER = 'x-platform-organization-session';

/** Revalidate both global authority and the selected tenant on every request. */
export async function resolvePlatformOperation(
  client: any, sessionId: unknown, user: { userId: string; email: string },
): Promise<TenantContext> {
  if (typeof sessionId !== 'string' || !/^[0-9a-f-]{36}$/i.test(sessionId)) {
    throw new ForbiddenException('Invalid organization session');
  }
  const { data, error } = await client.rpc('resolve_platform_organization_session', {
    target_session_id: sessionId, target_user_id: user.userId,
  });
  const row = Array.isArray(data) && data.length === 1 ? data[0] : null;
  if (error || !row || typeof row.organization_id !== 'string' ||
      typeof row.role_id !== 'string' || !Array.isArray(row.permissions) ||
      !row.permissions.every((p: unknown) => typeof p === 'string')) {
    throw new ForbiddenException('Organization session expired or access revoked');
  }
  return {
    scope: 'organization', ...user, organizationId: row.organization_id,
    organizationName: row.organization_name, role: 'admin_org', roleId: row.role_id,
    permissions: row.permissions, accessMode: 'platform_operation',
  };
}
