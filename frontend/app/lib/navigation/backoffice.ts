import {
  ORGANIZATION_PERMISSIONS,
  PLATFORM_PERMISSIONS,
} from '@/app/lib/permissions';

export interface BackofficeNavigationItem {
  group?: 'operation';
  permissionsAny?:string[];
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
    { href: '/backoffice/plans', label: 'Catálogo de planos', permission: 'e23a5c98-8b68-4ed2-aef8-70a7166407e4', scope: 'global' },
    { href: '/backoffice/licenses', label: 'Licença e módulos', permission: '8c5673e4-115c-4ab7-bb11-3b410eddcad3', scope: 'organization' },
    { href: '/backoffice/setup', label: 'Clientes e unidades', permission: 'cbb2e904-0718-4eec-9396-dba899118cdd', scope: 'organization' },
    { href: '/backoffice/contracts', label: 'Contratos', permission: '60f9690a-145b-4dba-b23f-9f945baca296', scope: 'organization' },
    { href: '/backoffice/documents', label: 'Documentos', permission: '8f105b02-4443-49de-b188-847e0284e7ed', scope: 'organization' },
    { href: '/backoffice/ocr-audit', label: 'Auditoria OCR', permission: '8f105b02-4443-49de-b188-847e0284e7ed', scope: 'organization' },
    {href:'/backoffice/operation/agenda',label:'Agenda',permission:'cb949e2a-e01d-4cf0-8c69-6ca74fe4d627',scope:'organization',group:'operation'},
    {href:'/backoffice/operation/requests',label:'Solicitações',permission:'1479c0b7-9608-4e95-bd83-7e6899255a78',scope:'organization',group:'operation'},
    {href:'/backoffice/operation/events',label:'Eventos',permission:'489e6387-d5fc-4cb0-81f9-d7a76269dca5',scope:'organization',group:'operation'},
    {href:'/backoffice/operation/pld',label:'PLD',permission:'966188be-1b54-4594-bcd1-596ba5ac8fde',scope:'organization',group:'operation'},
    {href:'/backoffice/operation/notifications',label:'Notificações',permissionsAny:['cb949e2a-e01d-4cf0-8c69-6ca74fe4d627','1479c0b7-9608-4e95-bd83-7e6899255a78','489e6387-d5fc-4cb0-81f9-d7a76269dca5'],scope:'organization',group:'operation'},
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
        item.permissionsAny ? item.permissionsAny.some(hasPermission) : item.permission === undefined ||
        hasPermission(item.permission)
      ),
  );
}
