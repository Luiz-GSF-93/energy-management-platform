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
import { SupabaseService } from '../../services/supabase.service';
import { TenantContext } from '../interfaces/tenant-context.interface';

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
    this.logger.log(`[TOKEN] Bearer token extracted`);

    try {
      // 3. Validar JWT com Supabase (autenticação autoritativa)
      const { data, error } = await this.supabaseService.getClient().auth.getUser(token);

      if (error || !data.user) {
        this.logger.error(`[SUPABASE_AUTH_FAIL] error=${error?.message}, user=${!data.user}`);
        throw new UnauthorizedException('Invalid token');
      }

      const userId = data.user.id;
      this.logger.log(`[SUPABASE_SUCCESS] userId extracted`);

      // 4. Extrair iat e exp do JWT (apenas leitura, sem verificação)
      let iat: number | undefined;
      let exp: number | undefined;

      try {
        const parts = token.split('.');
        if (parts.length === 3) {
          const payload = Buffer.from(parts[1], 'base64').toString('utf-8');
          const decoded = JSON.parse(payload);

          // Validar que iat e exp são números válidos
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
        // Continuar sem iat/exp (são opcionais)
      }

      // 5. Buscar perfil do usuário
      const { data: profile, error: profileError } = await this.supabaseService
        .getClient()
        .from('user_profiles')
        .select('organization_id')
        .eq('user_id', userId)
        .single();

      if (profileError || !profile) {
        this.logger.error(`[PROFILE_MISSING] userId extraction, profileError=${profileError?.message}`);
        // 401: usuário não tem profile — erro de autenticação
        throw new UnauthorizedException('User profile not found');
      }

      const activeOrgId = profile.organization_id;
      this.logger.log(`[PROFILE_FOUND] organization context set`);

      // 6. ✓ NOVO: Validar organização não deletada
      const { data: org, error: orgError } = await this.supabaseService
        .getClient()
        .from('organizations')
        .select('id, deleted_at')
        .eq('id', activeOrgId)
        .single();

      if (orgError || !org || org.deleted_at !== null) {
        this.logger.warn(
          `[ORG_DELETED] organization context not available`,
        );
        // 403: organização deletada ou não existe — erro de autorização
        throw new ForbiddenException(
          'Organization not available (deleted or does not exist)',
        );
      }

      this.logger.log(`[ORG_ACTIVE] organization validated`);

      // 7. ✓ NOVO: Procurar membership ativa em organization_members (fonte autoritativa)
      const { data: membership, error: membershipError } = await this.supabaseService
        .getClient()
        .from('organization_members')
        .select(
          `
          id,
          user_id,
          organization_id,
          role_id,
          status,
          roles(id, name, permissions, organization_id)
          `,
        )
        .eq('user_id', userId)
        .eq('organization_id', activeOrgId)
        .eq('status', 'active')
        .single();

      if (membershipError || !membership) {
        this.logger.warn(
          `[MEMBERSHIP_MISSING] no active membership in organization context`,
        );
        // 403: sem membership ativa — erro de autorização
        throw new ForbiddenException(
          'No active membership in this organization',
        );
      }

      this.logger.log(`[MEMBERSHIP_FOUND] membership validated`);

      // 8. ✓ NOVO: Validar role e extrair dados
      const role = (membership as any).roles;

      if (!role) {
        this.logger.error(
          `[ROLE_NOT_FOUND] role associated with membership is missing`,
        );
        // 403: role não encontrada — erro de autorização
        throw new ForbiddenException('Role not found');
      }

      // 9. ✓ NOVO: Validar alinhamento: role.organization_id === activeOrgId
      if (role.organization_id !== activeOrgId) {
        this.logger.error(
          `[ROLE_ORG_MISMATCH] role organization misaligned with context`,
        );
        // 403: role pertence a outra organização — erro de autorização
        throw new ForbiddenException('Role organization mismatch');
      }

      this.logger.log(`[ROLE_VALID] role validated`);

      // 10. Extrair permissions
      const permissions: string[] = Array.isArray(role.permissions) ? role.permissions : [];
      this.logger.log(`[PERMISSIONS] extracted from role`);

      // 11. Montar TenantContext (com roleId novo, iat/exp opcionais)
      const tenantContext: TenantContext = {
        userId,
        organizationId: activeOrgId,
        role: role.name,
        roleId: role.id,                     // ✓ NOVO
        permissions,
        email: data.user.email || '',
        iat,                                 // ✓ OPCIONAL: extraído do JWT
        exp,                                 // ✓ OPCIONAL: extraído do JWT
      };

      (request as any).tenantContext = tenantContext;
      this.logger.log(
        `[CONTEXT_SET] tenant context attached: role set, permissions count=${tenantContext.permissions.length}`,
      );

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
