import type { AuthContext, OrganizationAuthContext } from '@/app/lib/api/types';

// Older API versions omitted scope for ordinary organization memberships.
// Recognize that contract only with a complete, matching organization context.
export function isOrganizationAuthContext(value: AuthContext | null): value is OrganizationAuthContext {
  if (!value || (value.scope !== undefined && value.scope !== 'organization')) return false;
  const current = value.currentOrganization;
  return typeof value.user?.id === 'string' && value.user.id.length > 0 &&
    !!current && typeof current.id === 'string' && current.id.length > 0 &&
    typeof current.role === 'string' && current.role.length > 0 &&
    Array.isArray(current.permissions) && current.permissions.every(p => typeof p === 'string') &&
    Array.isArray(value.organizations) && value.organizations.some(o =>
      o.id === current.id && o.role === current.role);
}

export function normalizeAuthContext(value: AuthContext): AuthContext {
  if (value?.scope === 'global') return value;
  if (!isOrganizationAuthContext(value)) throw new Error('Contexto de acesso inválido. Entre novamente.');
  return { ...value, scope: 'organization' };
}
