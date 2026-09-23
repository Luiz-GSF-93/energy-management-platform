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
