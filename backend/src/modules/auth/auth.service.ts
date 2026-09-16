import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SupabaseService } from '../../services/supabase.service';
import { LoginDto, RegisterDto } from './dto/auth.dto';
import { TenantContext } from '../../common/interfaces/tenant-context.interface';

@Injectable()
export class AuthService {
  constructor(
    private supabaseService: SupabaseService,
    private configService: ConfigService,
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
      .getClient()
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
    const supabase = this.supabaseService.getClient();

    // Recuperar todas as organizações do usuário
    const { data: memberships } = await supabase
      .from('user_roles')
      .select(
        `
        user_id,
        roles (
          id,
          name,
          organization_id,
          permissions
        )
      `,
      )
      .eq('user_id', tenant.userId);

    // Mapear organizações únicas com seus roles
    const organizationsMap = new Map<
      string,
      {
        id: string;
        role: string;
        role_id: string;
        permissions: string[];
      }
    >();

    memberships?.forEach(
      (membership: {
        roles: {
          organization_id: string;
          name: string;
          id: string;
          permissions: string[];
        };
      }) => {
        if (membership.roles) {
          const key = membership.roles.organization_id;
          if (!organizationsMap.has(key)) {
            organizationsMap.set(key, {
              id: membership.roles.organization_id,
              role: membership.roles.name,
              role_id: membership.roles.id,
              permissions: membership.roles.permissions || [],
            });
          }
        }
      },
    );

    const organizations = Array.from(organizationsMap.values());

    // Organização atual
    const currentOrganization = organizations.find(
      (org) => org.id === tenant.organizationId,
    ) || organizations[0];

    return {
      user: {
        id: tenant.userId,
        email: tenant.email,
      },
      organizations: organizations.map((org) => ({
        id: org.id,
        role: org.role,
        role_id: org.role_id,
      })),
      currentOrganization: {
        id: currentOrganization?.id,
        role: currentOrganization?.role,
        permissions: currentOrganization?.permissions || [],
      },
    };
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
}
