import {
  ORGANIZATION_PERMISSIONS,
  PLATFORM_PERMISSIONS,
} from '@/app/lib/permissions';

export interface BackofficeNavigationItem {
  group?: 'operation' | 'reports';
  permissionsAny?:string[];
  permissionsAll?:string[];
  platformOperation?:boolean;
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
    { href:'/backoffice/platform-costs',label:'Custos e performance',permission:'e23a5c98-8b68-4ed2-aef8-70a7166407e4',scope:'global' },
    { href:'/backoffice/energy-map',label:'Mapa energético',permission:PLATFORM_PERMISSIONS.ORGANIZATIONS_VIEW,scope:'global' },
    { href: '/backoffice/plans', label: 'Catálogo de planos', permission: 'e23a5c98-8b68-4ed2-aef8-70a7166407e4', scope: 'global' },
    { href: '/backoffice/licenses', label: 'Licença e módulos', permission: '8c5673e4-115c-4ab7-bb11-3b410eddcad3', scope: 'organization' },
    { href: '/backoffice/setup', label: 'Clientes e unidades', permission: 'cbb2e904-0718-4eec-9396-dba899118cdd', scope: 'organization' },
    { href:'/backoffice/acl-admissions',label:'Adesão ACL',platformOperation:true,permissionsAll:['2c933fdf-0bbf-406a-915c-03e7921e54d8','cbb2e904-0718-4eec-9396-dba899118cdd'],scope:'organization' },
    { href: '/backoffice/energy-map', label: 'Mapa energético', permissionsAll: ['b142bd7b-05a3-45ee-befd-e593066c2775','cbb2e904-0718-4eec-9396-dba899118cdd'], scope: 'organization' },
    {href:'/backoffice/trading-hub',label:'Trading Hub',permission:'60f9690a-145b-4dba-b23f-9f945baca296',scope:'organization'},
    {href:'/backoffice/ccee-registrations',label:'Registros CCEE',permission:'f5364101-4486-42c2-a90f-807937ac3001',platformOperation:true,scope:'organization'},
    { href: '/backoffice/contracts', label: 'Contratos', permission: '60f9690a-145b-4dba-b23f-9f945baca296', scope: 'organization' },
    { href: '/backoffice/documents', label: 'Documentos', permission: '8f105b02-4443-49de-b188-847e0284e7ed', scope: 'organization' },
    { href: '/backoffice/ocr-audit', label: 'Auditoria OCR', permission: '8f105b02-4443-49de-b188-847e0284e7ed', scope: 'organization' },
    {href:'/backoffice/operation/agenda',label:'Agenda',permission:'cb949e2a-e01d-4cf0-8c69-6ca74fe4d627',scope:'organization',group:'operation'},
    {href:'/backoffice/reports/operational',label:'Operacional',permissionsAll:['3ebadd32-6f30-459e-8ed3-0d2843d89946','60f9690a-145b-4dba-b23f-9f945baca296'],scope:'organization',group:'reports'},
    {href:'/backoffice/reports/executive',label:'Executivo',permissionsAll:['3ebadd32-6f30-459e-8ed3-0d2843d89946','60f9690a-145b-4dba-b23f-9f945baca296'],scope:'organization',group:'reports'},
    {href:'/backoffice/reports/financial',label:'Financeiro',permissionsAll:['3ebadd32-6f30-459e-8ed3-0d2843d89946','60f9690a-145b-4dba-b23f-9f945baca296'],scope:'organization',group:'reports'},
    {href:'/backoffice/reports/configuration',label:'Configurações',permissionsAll:['3ebadd32-6f30-459e-8ed3-0d2843d89946','9541a7bb-c20a-4c4d-9f4c-2185262c8e9c','60f9690a-145b-4dba-b23f-9f945baca296','51da7cca-8196-4135-84ce-f989be5ee594'],scope:'organization',group:'reports'},
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
    {href:'/backoffice/settings',label:'Config. Ambiente'},
  ];

export function filterBackofficeNavigation(
  items: readonly BackofficeNavigationItem[],
  hasPermission: (permission: string) => boolean,
  scope?: 'global' | 'organization',
  platformOperation=false,
): BackofficeNavigationItem[] {
  return items.filter(
    (item) =>
      (
        item.scope === undefined ||
        item.scope === scope
      ) &&
      (
        (scope==='organization' && platformOperation && item.platformOperation===true) ||
        (item.permissionsAll ? item.permissionsAll.every(hasPermission) : item.permissionsAny ? item.permissionsAny.some(hasPermission) : item.permission === undefined ||
        hasPermission(item.permission))
      ),
  );
}
