import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common';

@Injectable()
export class TenantGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const user = request.user as any;

    if (!user || !user.tenant_id) {
      throw new ForbiddenException('Tenant não identificado');
    }

    request['tenant_id'] = user.tenant_id;
    return true;
  }
}
