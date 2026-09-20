import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PERMISSIONS_KEY } from '../decorators/require-permission.decorator';
import { RECOVERY_ENDPOINT_KEY } from '../decorators/recovery-endpoint.decorator';

@Injectable()
export class RoleGuard implements CanActivate {
  private readonly logger = new Logger(RoleGuard.name);

  constructor(private reflector: Reflector) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isRecoveryEndpoint = this.reflector.get<boolean>(
      RECOVERY_ENDPOINT_KEY,
      context.getHandler(),
    );

    if (isRecoveryEndpoint) {
      this.logger.debug('[RoleGuard] Recovery endpoint – skip permission check');
      return true;
    }

    const requiredPermissions = this.reflector.get<string[]>(
      PERMISSIONS_KEY,
      context.getHandler(),
    );

    if (!requiredPermissions || requiredPermissions.length === 0) {
      this.logger.debug('[RoleGuard] Nenhuma permissão requerida');
      return true;
    }

    const request = context.switchToHttp().getRequest();
    const authorizationContext =
      request.accessContext || request.tenantContext;

    this.logger.log(
      `[RoleGuard] Validando: ${requiredPermissions.join(', ')}`,
    );

    if (
      !authorizationContext ||
      !Array.isArray(authorizationContext.permissions)
    ) {
      this.logger.warn(
        `[RoleGuard] DENIED - Usuário sem contexto de autorização ou permissões`,
      );
      throw new ForbiddenException(
        'Usuário não possui permissões',
      );
    }

    const userPermissions = new Set(authorizationContext.permissions);
    const hasPermission = requiredPermissions.some((perm) =>
      userPermissions.has(perm),
    );

    if (!hasPermission) {
      this.logger.warn(
        `[RoleGuard] DENIED - Permissão necessária: ${requiredPermissions.join(', ')}`,
      );
      throw new ForbiddenException('Acesso negado');
    }

    this.logger.log(`[RoleGuard] GRANTED - Usuário autorizado`);
    return true;
  }
}
