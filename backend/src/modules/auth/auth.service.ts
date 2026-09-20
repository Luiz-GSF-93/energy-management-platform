import { Injectable, UnauthorizedException, ForbiddenException, InternalServerErrorException, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SupabaseService } from '../../services/supabase.service';
import { AuditService } from '../../common/services/audit.service';
import { LoginDto, RegisterDto } from './dto/auth.dto';
import { TenantContext } from '../../common/interfaces/tenant-context.interface';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  constructor(
    private supabaseService: SupabaseService,
    private configService: ConfigService,
    private auditService: AuditService,
  ) {}

  async register(registerDto: RegisterDto) {
    const { email, password, name } = registerDto;

    const { data, error } = await this.supabaseService
      .getClient()
      .auth.signUp({
        email,
        password,
        options: {
          data: { name },
        },
      });

    if (error) throw new UnauthorizedException(error.message);

    return {
      message: 'Usuário criado com sucesso. Verifique seu email.',
      user: data.user,
    };
  }

  async login(loginDto: LoginDto) {
    const { email, password } = loginDto;

    const { data, error } = await this.supabaseService
      .createAuthClient()
      .auth.signInWithPassword({
        email,
        password,
      });

    if (error) throw new UnauthorizedException('Credenciais inválidas');

    // Retorna o JWT do Supabase (já assinado e válido)
    return {
      access_token: data.session.access_token,
      refresh_token: data.session.refresh_token,
      user: {
        id: data.user.id,
        email: data.user.email,
        name: data.user.user_metadata?.name,
      },
    };
  }

  async getContext(tenant: TenantContext) {
    try {
      const supabase = this.supabaseService.getClient();

      const { data: memberships, error: membershipsError } = await supabase
        .from('organization_members')
        .select(`
          user_id,
          organization_id,
          role_id,
          status,
          roles(id, name, organization_id, permissions),
          organizations(id, name, deleted_at)
        `)
        .eq('user_id', tenant.userId)
        .eq('status', 'active');

      if (membershipsError) {
        this.logger.error('[getContext] Failed to load organization memberships');
        throw new InternalServerErrorException(
          'Failed to load organization context',
        );
      }

      const validMemberships = (memberships || []).filter(
        (membership: any) => {
          const organization = membership.organizations;
          const role = membership.roles;

          return (
            organization &&
            organization.deleted_at === null &&
            role &&
            membership.role_id === role.id &&
            role.organization_id === membership.organization_id
          );
        },
      );

      const currentMembership = validMemberships.find(
        (membership: any) =>
          membership.organization_id === tenant.organizationId,
      );

      if (!currentMembership) {
        throw new ForbiddenException(
          'No active membership in the current organization',
        );
      }

      const currentRole = currentMembership.roles;

      return {
        user: {
          id: tenant.userId,
          email: tenant.email,
        },
        organizations: validMemberships.map((membership: any) => ({
          id: membership.organization_id,
          role: membership.roles.name,
          role_id: membership.roles.id,
        })),
        currentOrganization: {
          id: currentMembership.organization_id,
          role: currentRole.name,
          permissions: Array.isArray(currentRole.permissions)
            ? currentRole.permissions
            : [],
        },
      };
    } catch (err) {
      if (
        err instanceof ForbiddenException ||
        err instanceof InternalServerErrorException
      ) {
        throw err;
      }

      this.logger.error('[getContext] Unexpected error');
      throw new InternalServerErrorException(
        'Failed to load organization context',
      );
    }
  }

  async getProfile(tenant: TenantContext) {
    return {
      user_id: tenant.userId,
      email: tenant.email,
      organization_id: tenant.organizationId,
      role: tenant.role,
      permissions: tenant.permissions,
    };
  }

  async validateToken(token: string) {
    try {
      const supabase = this.supabaseService.getClient();
      const { data, error } = await supabase.auth.getUser(token);

      if (error || !data.user) {
        throw new UnauthorizedException('Token inválido');
      }

      return data.user;
    } catch (error) {
      throw new UnauthorizedException('Token inválido');
    }
  }

  async getMyOrganizations(userId: string): Promise<any> {
    try {
      this.logger.debug(`[getMyOrganizations] Iniciado`);

      const { data: profile, error: profileError } = await this.supabaseService
        .getClient()
        .from('user_profiles')
        .select('organization_id')
        .eq('user_id', userId)
        .single();

      if (profileError || !profile) {
        if (profileError) {
          const profileErrorCode =
            typeof profileError.code === 'string' &&
            /^[A-Za-z0-9_-]+$/.test(profileError.code)
              ? profileError.code
              : 'REDACTED';

          const profileErrorStatus =
            typeof profileError.status === 'number' &&
            Number.isInteger(profileError.status)
              ? String(profileError.status)
              : 'UNKNOWN';

          const profileErrorName =
            typeof profileError.name === 'string' &&
            /^[A-Za-z0-9_-]+$/.test(profileError.name)
              ? profileError.name
              : 'REDACTED';

        }
        this.logger.error(`[getMyOrganizations] Profile não encontrado`);
        throw new UnauthorizedException('Profile not found');
      }

      const currentOrgId = profile.organization_id;

      const { data: memberships, error: memError } = await this.supabaseService
        .getClient()
        .from('organization_members')
        .select(`
          user_id,
          organization_id,
          role_id,
          status,
          roles(id, name, organization_id, permissions),
          organizations(id, name, deleted_at)
        `)
        .eq('user_id', userId)
        .eq('status', 'active');

      if (memError) {
        this.logger.error(`[getMyOrganizations] Query error`);
        throw new InternalServerErrorException(
        'Failed to load organization memberships',
      );
      }

      if (!memberships || memberships.length === 0) {
        this.logger.warn(`[getMyOrganizations] Nenhuma membership ativa`);
        return [];
      }

      const validMemberships = memberships
        .filter((m: any) => {
          const org = m.organizations;
          const role = m.roles;
          return org && org.deleted_at === null && role && role.organization_id === m.organization_id;
        })
        .map((m: any) => ({
          organizationId: m.organization_id,
          organizationName: m.organizations.name,
          role: m.roles.name,
          roleId: m.roles.id,
          isActive: m.organization_id === currentOrgId,
        }));

      this.logger.log(
        `[getMyOrganizations] Retornando ${validMemberships.length} memberships`,
      );

      return validMemberships;
    } catch (err) {
      if (
        err instanceof UnauthorizedException ||
        err instanceof ForbiddenException ||
        err instanceof InternalServerErrorException
      ) {
        throw err;
      }

      this.logger.error('[getMyOrganizations] Unexpected error');
      throw new InternalServerErrorException(
        'Failed to load organizations',
      );
    }
  }

  /**
   * Troca a organização ativa do usuário.
   */

  async switchOrganization(
    userId: string,
    organizationId: string,
    ipAddress?: string,
    userAgent?: string,
  ): Promise<any> {
    try {
      this.logger.debug(
        `[switchOrganization] Iniciado`,
      );

      const { data: currentProfile, error: profileError } = await this.supabaseService
        .getClient()
        .from('user_profiles')
        .select('organization_id')
        .eq('user_id', userId)
        .single();

      if (profileError || !currentProfile) {
        this.logger.error(`[switchOrganization] Profile não encontrado`);
        throw new UnauthorizedException('Profile not found');
      }

      const fromOrgId = currentProfile.organization_id;

      // === OPTION 5: Classify context for audit (NORMAL vs RECOVERY) ==="
      let auditOrganizationId: string;
      let recovery = false;
      let fromRoleId: string | null = null;

      if (fromOrgId === null) {
        recovery = true;
        auditOrganizationId = organizationId;
        this.logger.debug(`[switchOrganization] Recovery: prior context missing`);
      } else {
        const { data: priorOrgArray, error: priorOrgError } = await this.supabaseService
          .getClient()
          .from('organizations')
          .select('id, deleted_at')
          .eq('id', fromOrgId);

        if (priorOrgError) {
          throw new InternalServerErrorException(`Failed to check prior organization`);
        }

        if (!priorOrgArray || priorOrgArray.length === 0) {
          recovery = true;
          auditOrganizationId = organizationId;
        } else if (priorOrgArray.length === 1) {
          const priorOrg = priorOrgArray[0];

          if (priorOrg.deleted_at !== null) {
            recovery = true;
            auditOrganizationId = organizationId;
          } else {
            recovery = false;
            auditOrganizationId = fromOrgId;
          }

          const { data: priorMemberships, error: priorMembershipError } =
            await this.supabaseService
              .getClient()
              .from('organization_members')
              .select('role_id, roles(id, organization_id)')
              .eq('user_id', userId)
              .eq('organization_id', fromOrgId);

          if (priorMembershipError) {
            throw new InternalServerErrorException(
              'Failed to resolve prior organization membership',
            );
          }

          if (priorMemberships && priorMemberships.length > 1) {
            throw new InternalServerErrorException(
              'Data integrity error: multiple prior organization memberships found',
            );
          }

          if (priorMemberships && priorMemberships.length === 1) {
            const priorMembership = priorMemberships[0];
            const priorRole = (priorMembership as any).roles;

            if (
              priorMembership.role_id &&
              priorRole &&
              priorRole.id === priorMembership.role_id &&
              priorRole.organization_id === fromOrgId
            ) {
              fromRoleId = priorRole.id;
            }
          }
        } else {
          throw new InternalServerErrorException(`Data integrity error: multiple organizations found for prior context`);
        }
      }

      const { data: targetOrgs, error: orgError } = await this.supabaseService
        .getClient()
        .from('organizations')
        .select('id, name')
        .eq('id', organizationId)
        .is('deleted_at', null);

      if (orgError || !targetOrgs || targetOrgs.length === 0) {
        this.logger.warn(`[switchOrganization] Organização alvo não encontrada ou deletada`);
        throw new ForbiddenException('Target organization not found or deleted');
      }

      if (targetOrgs.length > 1) {
        throw new InternalServerErrorException(
          'Data integrity error: multiple target organizations found',
        );
      }

      const targetOrg = targetOrgs[0];

      const { data: memberships, error: memError } = await this.supabaseService
        .getClient()
        .from('organization_members')
        .select('role_id, status, roles(id, name, organization_id, permissions)')
        .eq('user_id', userId)
        .eq('organization_id', organizationId)
        .eq('status', 'active');

      if (memError || !memberships || memberships.length === 0) {
        this.logger.warn(`[switchOrganization] Sem membership ativa na target org`);
        throw new ForbiddenException('No active membership in target organization');
      }

      if (memberships.length > 1) {
        throw new InternalServerErrorException(
          'Data integrity error: multiple active memberships found',
        );
      }

      const membership = memberships[0];
      const role = (membership as any).roles;

      if (!role || role.organization_id !== organizationId) {
        this.logger.error(`[switchOrganization] Role inválida`);
        throw new ForbiddenException('Role invalid or does not belong to target organization');
      }

      if (fromOrgId === organizationId) {
        this.logger.log('[switchOrganization] Same-org idempotent');
        return {
          organizationId,
          organizationName: targetOrg.name,
          role: role.name,
          roleId: role.id,
          message: 'Já está na organização alvo',
        };
      }

      let updateQuery = this.supabaseService
        .getClient()
        .from('user_profiles')
        .update({ organization_id: organizationId })
        .eq('user_id', userId);

      if (fromOrgId === null) {
        updateQuery = updateQuery.is('organization_id', null);
      } else {
        updateQuery = updateQuery.eq('organization_id', fromOrgId);
      }

      const { data: updateData, error: updateError } = await updateQuery.select();

      if (updateError) {
        this.logger.error(`[switchOrganization] UPDATE failed`);
        throw new InternalServerErrorException('Update failed');
      }

      if (!updateData) {
        this.logger.error(`[switchOrganization] CAS FAILED: update returned no data`);
        throw new InternalServerErrorException('Concurrent switch detected. Please retry.');
      }

      if (updateData.length === 0) {
        this.logger.warn(`[switchOrganization] CAS CONFLICT: 0 rows updated`);
        throw new InternalServerErrorException('Concurrent switch detected. Please retry.');
      }

      if (updateData.length > 1) {
        this.logger.error(`[switchOrganization] CAS INTEGRITY ERROR: unexpected multiple rows affected`);
        throw new InternalServerErrorException('Critical integrity error. Admin intervention required.');
      }

      this.logger.log(
        `[switchOrganization] Profile updated`,
      );

      try {
        await this.auditService.logOrganizationSwitch({
          userId,
          fromOrganizationId: fromOrgId,
          toOrganizationId: organizationId,
          fromRoleId,
          toRoleId: role.id,
          auditOrganizationId,
          recovery,
          status: 'success',
          ipAddress,
          userAgent,
        });
      } catch (auditErr) {
        this.logger.error(
          `[switchOrganization] Audit insert failed, attempting rollback`,
        );

        const { data: rollbackData, error: rollbackError } = await this.supabaseService
          .getClient()
          .from('user_profiles')
          .update({ organization_id: fromOrgId })
          .eq('user_id', userId)
          .eq('organization_id', organizationId)
          .select();

        if (rollbackError || !rollbackData || rollbackData.length !== 1) {
          this.logger.error(
            `[switchOrganization] CRITICAL: Rollback failed`,
          );
          throw new InternalServerErrorException(
            'CRITICAL: Audit failed and rollback also failed. Admin intervention required.',
          );
        }

        this.logger.warn(`[switchOrganization] Rollback bem-sucedido após falha de audit`);
        throw new InternalServerErrorException('Audit logging failed. Switch reverted.');
      }

      this.logger.log(
        `[switchOrganization] Success`,
      );

      return {
        organizationId,
        organizationName: targetOrg.name,
        role: role.name,
        roleId: role.id,
        message: 'Troca de organização bem-sucedida',
      };
    } catch (err) {
      if (
        err instanceof UnauthorizedException ||
        err instanceof ForbiddenException ||
        err instanceof InternalServerErrorException
      ) {
        throw err;
      }

      this.logger.error('[switchOrganization] Unexpected error');
      throw new InternalServerErrorException('Erro ao trocar organização');
    }
  }
}
