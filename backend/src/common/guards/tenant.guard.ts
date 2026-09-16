import { Injectable, CanActivate, ExecutionContext, UnauthorizedException, Logger } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import { PUBLIC_KEY } from '../decorators/public.decorator';
import { SupabaseService } from '../../services/supabase.service';

@Injectable()
export class TenantGuard implements CanActivate {
  private logger = new Logger('TenantGuard');

  constructor(
    private reflector: Reflector,
    private supabaseService: SupabaseService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    this.logger.log(`[ENTRY] canActivate called for ${context.getClass().name}.${context.getHandler().name}`);

    const request: Request = context.switchToHttp().getRequest();

    // 1. Verificar @Public
    const isPublic = this.reflector.getAllAndOverride<boolean>(PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    this.logger.log(`[PUBLIC_CHECK] isPublic=${isPublic}, path=${request.path}, method=${request.method}`);

    if (isPublic) {
      this.logger.log(`[ALLOW] Route is public, skipping tenant guard`);
      return true;
    }

    // 2. Extrair token
    const authHeader = request.headers['authorization'];
    this.logger.log(`[TOKEN_EXTRACT] authorization header present=${!!authHeader}`);

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      this.logger.error(`[FAIL] Missing or invalid bearer token`);
      throw new UnauthorizedException('No token provided');
    }

    const token = authHeader.substring(7);
    this.logger.log(`[TOKEN] Extracted token (first 50 chars): ${token.substring(0, 50)}...`);

    // 3. Validar JWT com Supabase
    try {
      const { data, error } = await this.supabaseService.getClient().auth.getUser(token);

      if (error || !data.user) {
        this.logger.error(`[SUPABASE_AUTH_FAIL] error=${error?.message}, user=${!data.user}`);
        throw new UnauthorizedException('Invalid token');
      }

      const userId = data.user.id;
      this.logger.log(`[SUPABASE_SUCCESS] userId=${userId}`);

      // 4. Buscar organização
      const { data: profile, error: profileError } = await this.supabaseService
        .getClient()
        .from('user_profiles')
        .select('organization_id')
        .eq('user_id', userId)
        .single();

      if (profileError || !profile) {
        this.logger.warn(`[PROFILE_MISSING] userId=${userId}, profileError=${profileError?.message}`);
      } else {
        this.logger.log(`[PROFILE_FOUND] organization_id=${profile.organization_id}`);
      }

      // 5. Buscar role - ESTRATÉGIA ALTERNATIVA: dois passos
      let roleData = null;
      let permissions: any[] = [];

      // Passo 5a: Buscar user_role record
      const { data: userRoleRecord, error: userRoleError } = await this.supabaseService
        .getClient()
        .from('user_roles')
        .select('role_id')
        .eq('user_id', userId)
        .single();

      if (userRoleError || !userRoleRecord) {
        this.logger.warn(`[USER_ROLE_MISSING] userId=${userId}, error=${userRoleError?.message}`);
      } else {
        this.logger.log(`[USER_ROLE_FOUND] role_id=${userRoleRecord.role_id}`);

        // Passo 5b: Buscar role por ID
        const { data: roleRecord, error: roleError } = await this.supabaseService
          .getClient()
          .from('roles')
          .select('name, permissions')
          .eq('id', userRoleRecord.role_id)
          .single();

        if (roleError || !roleRecord) {
          this.logger.warn(`[ROLE_LOOKUP_FAILED] role_id=${userRoleRecord.role_id}, error=${roleError?.message}`);
        } else {
          this.logger.log(`[ROLE_FOUND] name=${roleRecord.name}, perms_count=${Array.isArray(roleRecord.permissions) ? roleRecord.permissions.length : 0}`);
          roleData = roleRecord;
          permissions = roleRecord.permissions || [];
        }
      }

      // 6. Montar contexto e anexar ao request
      const tenantContext = {
        userId,
        organizationId: profile?.organization_id || 'org_default',
        role: roleData?.name || 'user',
        permissions: permissions,
        email: data.user.email,
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + 604800,
      };

      (request as any).tenantContext = tenantContext;
      this.logger.log(`[CONTEXT_SET] tenant context attached: org=${tenantContext.organizationId}, role=${tenantContext.role}, perms_count=${tenantContext.permissions.length}`);

      return true;
    } catch (err) {
      const error = err as Error;
      this.logger.error(`[EXCEPTION] ${error.message}`, error.stack);
      throw new UnauthorizedException(`Guard failed: ${error.message}`);
    }
  }
}
