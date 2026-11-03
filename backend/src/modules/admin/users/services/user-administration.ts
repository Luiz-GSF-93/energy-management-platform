import {ForbiddenException} from '@nestjs/common';
import {TenantContext} from '../../../../common/interfaces/tenant-context.interface';

/** A permission UUID alone never turns a manager/operator into an administrator. */
export function assertUserAdministrator(t:TenantContext) {
  if (!t || (t.scope as string)==='global' || !t.organizationId || !t.userId ||
      t.role!=='admin_org' && t.accessMode!=='platform_operation') {
    throw new ForbiddenException('Somente o Administrador da organização pode cadastrar usuários ou configurar permissões.');
  }
}

export function delegationPermissions(permissions:string[]) {
  const copy=[...permissions];
  if (copy.includes('beb6ec90-8ba8-40ce-a156-aeef6cc75cce') && !copy.includes('f1c2d3a4-7c53-4b05-8ed3-f32b88f32131')) copy.push('f1c2d3a4-7c53-4b05-8ed3-f32b88f32131');
  return copy;
}
