import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
  ForbiddenException,
  Logger
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import { PUBLIC_KEY } from '../decorators/public.decorator';
import { RECOVERY_ENDPOINT_KEY } from '../decorators/recovery-endpoint.decorator';
import { PLATFORM_SCOPE_KEY } from '../decorators/platform-scope.decorator';
import { SupabaseService } from '../../services/supabase.service';
import {
  PlatformContext,
  TenantContext,
} from '../interfaces/tenant-context.interface';
import { AuthenticatedUser, RequestWithAuthenticatedUser } from '../interfaces/authenticated-user.interface';

@Injectable()
export class TenantGuard implements CanActivate {
  private logger = new Logger('TenantGuard');

  constructor(
    private reflector: Reflector,
    private supabaseService: SupabaseService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    this.logger.log(`[ENTRY] canActivate called for ${context.getClass().name}.${context.getHandler().name}`);

    const request: RequestWithAuthenticatedUser = context.switchToHttp().getRequest();

    // 1. Verificar @Public (PRESERVADO DO ORIGINAL)
    const isPublic = this.reflector.getAllAndOverride<boolean>(PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    this.logger.log(`[PUBLIC_CHECK] isPublic=${isPublic}, path=${request.path}, method=${request.method}`);

    if (isPublic) {
      this.logger.log(`[ALLOW] Route is public, skipping tenant guard`);
      return true;
    }

    // 2. Extrair token (PRESERVADO DO ORIGINAL)
    const authHeader = request.headers['authorization'];
    this.logger.log(`[TOKEN_EXTRACT] authorization header present=${!!authHeader}`);

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      this.logger.error(`[FAIL] Missing or invalid bearer token`);
      throw new UnauthorizedException('No token provided');
    }

    const token = authHeader.substring(7);
    this.logger.log(`[TOKEN] Bearer token extracted`);

    try {
      // 3. Validar JWT com Supabase (PRESERVADO DO ORIGINAL - autenticação autoritativa)

      const { data, error } = await this.supabaseService.getClient().auth.getUser(token);

      if (error || !data.user) {
        this.logger.error(`[SUPABASE_AUTH_FAIL] error=${error?.message}, user=${!data.user}`);
        throw new UnauthorizedException('Invalid token');
      }

      const userId = data.user.id;
      this.logger.log(`[SUPABASE_SUCCESS] userId extracted`);

      // 4. Extrair iat e exp do JWT (PRESERVADO DO ORIGINAL - apenas leitura, sem verificação)
      let iat: number | undefined;
      let exp: number | undefined;

      try {
        const parts = token.split('.');
        if (parts.length === 3) {
          const payload = Buffer.from(parts[1], 'base64').toString('utf-8');
          const decoded = JSON.parse(payload);

          if (typeof decoded.iat === 'number') {
            iat = decoded.iat;
          }
          if (typeof decoded.exp === 'number') {
            exp = decoded.exp;
          }

          this.logger.log(`[JWT_DECODED] iat e exp extraídos com sucesso`);
        }
      } catch (decodeError) {
        this.logger.warn(`[JWT_DECODE_WARNING] Não foi possível extrair iat/exp: ${(decodeError as Error).message}`);
      }

      // 5. Buscar perfil do usuário (PRESERVADO DO ORIGINAL)

      const { data: profile, error: profileError } = await this.supabaseService
        .getClient()
        .from('user_profiles')
        .select('organization_id')
        .eq('user_id', userId)
        .single();

      if (profileError || !profile) {
        this.logger.error(`[PROFILE_MISSING] userId extraction, profileError=${profileError?.message}`);
        throw new UnauthorizedException('User profile not found');
      }

      // ✅ NOVO: Montar authenticatedUser após validação JWT + profile
      const authenticatedUser: AuthenticatedUser = {
        userId,
        email: data.user.email || '',
        iat,
        exp,
      };
      request.authenticatedUser = authenticatedUser;
      this.logger.log(`[AUTHENTICATED_USER] attached: userId=${userId}, email=${authenticatedUser.email}`);

      // ✅ NOVO: Verificar se é recovery endpoint
      const isRecoveryEndpoint = this.reflector.get<boolean>(
        RECOVERY_ENDPOINT_KEY,
        context.getHandler(),
      );

      if (isRecoveryEndpoint) {
        this.logger.log(`[RECOVERY_ENDPOINT] JWT + profile validado. Retornando sem resolver full tenant context.`);
        return true;
      }

      // Phase 5.7 — resolver escopo global somente quando o handler
      // declarar explicitamente @PlatformScope().
      const isPlatformScope = this.reflector.getAllAndOverride<boolean>(
        PLATFORM_SCOPE_KEY,
        [
          context.getHandler(),
          context.getClass(),
        ],
      );

      if (isPlatformScope) {
        const { data: globalAssignments, error: globalAssignmentError } =
          await this.supabaseService
            .getClient()
            .from('user_roles')
            .select(`
              user_id,
              role_id,
              roles(id, name, permissions, scope)
            `)
            .eq('user_id', userId);

        if (globalAssignmentError) {
          this.logger.error(
            `[PLATFORM_ROLE_QUERY_FAILED] unable to resolve global assignment`,
          );
          throw new ForbiddenException('Platform authorization unavailable');
        }

        const validGlobalAssignments = (globalAssignments || []).filter(
          (assignment: any) => {
            const role = assignment?.roles;

            return (
              assignment?.user_id === userId &&
              assignment?.role_id &&
              role &&
              assignment.role_id === role.id &&
              role.scope === 'global' &&
              Array.isArray(role.permissions)
            );
          },
        );

        if (validGlobalAssignments.length !== 1) {
          this.logger.warn(
            `[PLATFORM_ROLE_INVALID] expected exactly one valid global assignment`,
          );
          throw new ForbiddenException('Invalid platform authorization');
        }

        const globalRole = validGlobalAssignments[0].roles;

        const platformContext: PlatformContext = {
          scope: 'global',
          userId,
          role: globalRole.name,
          roleId: globalRole.id,
          permissions: globalRole.permissions,
          email: data.user.email || '',
          iat,
          exp,
        };

        (request as any).accessContext = platformContext;

        this.logger.log(
          `[PLATFORM_CONTEXT_SET] global context attached: permissions count=${platformContext.permissions.length}`,
        );

        return true;
      }

      // ========== FLUXO NORMAL (5.5b.1 PRESERVADO) ==========

      const activeOrgId = profile.organization_id;
      this.logger.log(`[PROFILE_FOUND] organization context set`);

      // 6. ✓ Validar organização não deletada (PRESERVADO DO ORIGINAL)
      const { data: org, error: orgError } = await this.supabaseService
        .getClient()
        .from('organizations')
        .select('id, deleted_at')
        .eq('id', activeOrgId)
        .single();

      if (orgError || !org || org.deleted_at !== null) {
        this.logger.warn(`[ORG_DELETED] organization context not available`);
        throw new ForbiddenException('Organization not available (deleted or does not exist)');
      }

      this.logger.log(`[ORG_ACTIVE] organization validated`);

      // 7. ✓ Procurar membership ativa (PRESERVADO DO ORIGINAL)
      const { data: membership, error: membershipError } = await this.supabaseService
        .getClient()
        .from('organization_members')
        .select(`
          id,
          user_id,
          organization_id,
          role_id,
          status,
          roles(id, name, permissions, organization_id, scope)
        `)
        .eq('user_id', userId)
        .eq('organization_id', activeOrgId)
        .eq('status', 'active')
        .single();

      if (membershipError || !membership) {
        this.logger.warn(`[MEMBERSHIP_MISSING] no active membership in organization context`);
        throw new ForbiddenException('No active membership in this organization');
      }

      this.logger.log(`[MEMBERSHIP_FOUND] membership validated`);

      // 8. ✓ Validar role (PRESERVADO DO ORIGINAL)
      const role = (membership as any).roles;

      if (!role) {
        this.logger.error(`[ROLE_NOT_FOUND] role associated with membership is missing`);
        throw new ForbiddenException('Role not found');
      }

      // 9. ✓ Validar alinhamento: role.organization_id === activeOrgId (PRESERVADO DO ORIGINAL)
      if (role.organization_id !== activeOrgId) {
        this.logger.error(`[ROLE_ORG_MISMATCH] role organization misaligned with context`);
        throw new ForbiddenException('Role organization mismatch');
      }

      if (role.scope !== 'organization') {
        this.logger.error(
          `[ROLE_SCOPE_MISMATCH] organization membership resolved a non-organization role`,
        );
        throw new ForbiddenException('Role scope mismatch');
      }

      this.logger.log(`[ROLE_VALID] role validated`);

      // 10. Extrair permissions (PRESERVADO DO ORIGINAL)
      const permissions: string[] = Array.isArray(role.permissions) ? role.permissions : [];
      this.logger.log(`[PERMISSIONS] extracted from role`);

      // 11. Montar TenantContext completo (PRESERVADO DO ORIGINAL + NOVO roleId)
      const tenantContext: TenantContext = {
        scope: 'organization',
        userId,
        organizationId: activeOrgId,
        role: role.name,
        roleId: role.id,
        permissions,
        email: data.user.email || '',
        iat,
        exp,
      };

      (request as any).tenantContext = tenantContext;
      (request as any).accessContext = tenantContext;
      this.logger.log(`[CONTEXT_SET] tenant context attached: role set, permissions count=${tenantContext.permissions.length}`);

      return true;
    } catch (err) {
      if (err instanceof UnauthorizedException || err instanceof ForbiddenException) {
        throw err;
      }
      const error = err as Error;
      this.logger.error(`[EXCEPTION] ${error.message}`, error.stack);
      throw new UnauthorizedException(`Guard failed: ${error.message}`);
    }
  }
}
