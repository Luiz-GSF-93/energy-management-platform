import { PLATFORM_PERMISSIONS } from '@/app/lib/permissions';

export interface BackofficeNavigationItem {
  href: string;
  label: string;
  permission?: string;
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
  ];

export function filterBackofficeNavigation(
  items: readonly BackofficeNavigationItem[],
  hasPermission: (permission: string) => boolean,
): BackofficeNavigationItem[] {
  return items.filter(
    (item) =>
      item.permission === undefined ||
      hasPermission(item.permission),
  );
}
