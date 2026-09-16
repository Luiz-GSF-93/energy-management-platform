import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ROLES_KEY, PERMISSIONS_KEY } from '../decorators/roles.decorator';
import { RequestWithTenant } from '../interfaces/tenant-context.interface';

@Injectable()
export class RoleGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<string[]>(
      ROLES_KEY,
      [context.getHandler(), context.getClass()],
    );
    const requiredPermissions = this.reflector.getAllAndOverride<string[]>(
      PERMISSIONS_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (!requiredRoles && !requiredPermissions) {
      return true;
    }

    const request = context.switchToHttp().getRequest<RequestWithTenant>();
    const { role, permissions } = request.tenantContext || {};

    if (requiredRoles && role && !requiredRoles.includes(role)) {
      throw new ForbiddenException(
        `Insufficient role permissions. Required roles: ${requiredRoles.join(', ')}`,
      );
    }

    if (
      requiredPermissions &&
      !requiredPermissions.some((perm) => permissions?.includes(perm))
    ) {
      throw new ForbiddenException(
        `Insufficient permissions. Required: ${requiredPermissions.join(', ')}`,
      );
    }

    return true;
  }
}
