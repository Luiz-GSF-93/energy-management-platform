import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RequestWithTenant, TenantContext } from '../interfaces/tenant-context.interface';
import { PUBLIC_KEY } from '../decorators/public.decorator';
import { SupabaseService } from '../../services/supabase.service';

@Injectable()
export class TenantGuard implements CanActivate {
  constructor(
    private reflector: Reflector,
    private supabaseService: SupabaseService,
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
      // Validar token usando Supabase
      const supabase = this.supabaseService.getClient();
      const { data, error } = await supabase.auth.getUser(token);

      if (error || !data.user) {
        throw new UnauthorizedException('Invalid token');
      }

      // Recuperar dados de tenant do BD
      const { data: profile, error: profileError } = await supabase
        .from('user_profiles')
        .select('organization_id, role_id, email, name')
        .eq('user_id', data.user.id)
        .single();

      if (profileError || !profile) {
        throw new UnauthorizedException('User profile not found');
      }

      // Montar TenantContext
      const tenantContext: TenantContext = {
        userId: data.user.id,
        organizationId: profile.organization_id || 'org_default',
        role: profile.role_id || 'user',
        permissions: [], // Será carregado depois se necessário
        email: profile.email || data.user.email,
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + 604800, // 7 dias
      };

      request.tenantContext = tenantContext;
      return true;
    } catch (error) {
      if (error instanceof UnauthorizedException) {
        throw error;
      }
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
