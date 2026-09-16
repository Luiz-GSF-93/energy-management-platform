import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PERMISSIONS_KEY } from '../decorators/require-permission.decorator';

@Injectable()
export class RoleGuard implements CanActivate {
  private readonly logger = new Logger(RoleGuard.name);

  constructor(private reflector: Reflector) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const requiredPermissions = this.reflector.get<string[]>(
      PERMISSIONS_KEY,
      context.getHandler(),
    );

    if (!requiredPermissions || requiredPermissions.length === 0) {
      this.logger.debug('[RoleGuard] Nenhuma permissão requerida');
      return true;
    }

    const request = context.switchToHttp().getRequest();
    const tenantContext = request.tenantContext;

    this.logger.log(
      `[RoleGuard] Validando: ${requiredPermissions.join(', ')}`,
    );

    if (!tenantContext || !tenantContext.permissions) {
      this.logger.warn(
        `[RoleGuard] DENIED - Usuário sem tenantContext ou permissões`,
      );
      throw new ForbiddenException(
        'Usuário não possui permissões',
      );
    }

    const userPermissions = new Set(tenantContext.permissions);
    const hasPermission = requiredPermissions.some((perm) =>
      userPermissions.has(perm),
    );

    if (!hasPermission) {
      this.logger.warn(
        `[RoleGuard] DENIED - Permissão necessária: ${requiredPermissions.join(', ')}`,
      );
      throw new ForbiddenException(
        'Acesso negado',
      );
    }

    this.logger.log(`[RoleGuard] GRANTED - Usuário autorizado`);
    return true;
  }
}
