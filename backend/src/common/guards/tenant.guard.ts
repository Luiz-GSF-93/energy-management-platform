import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { RequestWithTenant, TenantContext } from '../interfaces/tenant-context.interface';
import { PUBLIC_KEY } from '../decorators/public.decorator';

@Injectable()
export class TenantGuard implements CanActivate {
  constructor(
    private jwtService: JwtService,
    private reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    // Verificar se rota é pública
    const isPublic = this.reflector.getAllAndOverride<boolean>(PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isPublic) {
      return true;
    }

    const request = context.switchToHttp().getRequest<RequestWithTenant>();
    const token = this.extractToken(request);

    if (!token) {
      throw new UnauthorizedException('No token provided');
    }

    try {
      const payload = this.jwtService.verify(token);

      const tenantContext: TenantContext = {
        userId: payload.sub,
        organizationId: payload.organization_id || 'org_default',
        role: payload.role || 'user',
        permissions: payload.permissions || [],
        email: payload.email,
        iat: payload.iat,
        exp: payload.exp,
      };

      request.tenantContext = tenantContext;
      return true;
    } catch (error) {
      if (error instanceof Error) {
        throw new UnauthorizedException(`Invalid token: ${error.message}`);
      }
      throw new UnauthorizedException('Invalid token');
    }
  }

  private extractToken(request: RequestWithTenant): string | null {
    const authHeader = request.headers.authorization;
    if (!authHeader) {
      return null;
    }

    const [scheme, token] = authHeader.split(' ');
    if (scheme !== 'Bearer') {
      return null;
    }

    return token;
  }
}
