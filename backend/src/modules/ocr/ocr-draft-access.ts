import {TenantContext} from '../../common/interfaces/tenant-context.interface';
import {PERMISSIONS as P} from '../../common/constants/permissions';
export function ocrDraftRole(t:TenantContext){return !!t?.organizationId&&!!t.userId&&(['operacional','gestor','admin_org'].includes(t.role)||t.accessMode==='platform_operation');}
// Operational UPDATE permits only the audited OCR draft services invoked by the assistant.
// Financial validation/approval and generic contract creation keep their existing guards.
export function ocrDraftPermission(t:TenantContext){return !!t?.permissions&&(t.permissions.includes(P.ORGANIZATION_CONTRACTS_CREATE)||(t.role==='operacional'&&t.permissions.includes(P.ORGANIZATION_CONTRACTS_UPDATE)));}
