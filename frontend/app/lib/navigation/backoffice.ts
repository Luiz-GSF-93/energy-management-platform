import {
  ORGANIZATION_PERMISSIONS,
  PLATFORM_PERMISSIONS,
} from '@/app/lib/permissions';

export interface BackofficeNavigationItem {
  href: string;
  label: string;
  permission?: string;
  scope?: 'global' | 'organization';
}

export const backofficeNavigation:
  readonly BackofficeNavigationItem[] = [
    {
      href: '/backoffice/dashboard',
      label: 'Dashboard',
    },
    {
      href: '/backoffice/organizations',
      label: 'Organizações',
      permission:
        PLATFORM_PERMISSIONS.ORGANIZATIONS_VIEW,
    },
    { href: '/backoffice/documents', label: 'Documentos', permission: '8f105b02-4443-49de-b188-847e0284e7ed', scope: 'organization' },
    {
      href: '/backoffice/users',
      label: 'Usuários',
      permission:
        ORGANIZATION_PERMISSIONS.USERS_VIEW,
      scope: 'organization',
    },
  ];

export function filterBackofficeNavigation(
  items: readonly BackofficeNavigationItem[],
  hasPermission: (permission: string) => boolean,
  scope?: 'global' | 'organization',
): BackofficeNavigationItem[] {
  return items.filter(
    (item) =>
      (
        item.scope === undefined ||
        item.scope === scope
      ) &&
      (
        item.permission === undefined ||
        hasPermission(item.permission)
      ),
  );
}
