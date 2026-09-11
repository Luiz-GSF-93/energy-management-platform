import { Injectable, UnauthorizedException, Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { LoginDto } from '../../common/dtos/auth.dto';

interface TestUser {
  id: string;
  email: string;
  password: string;
  role: string;
  name: string;
  tenant_id: string;
  tenant_name: string;
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger('AuthService');

  private readonly testUsers: TestUser[] = [
    {
      id: '1',
      email: 'admin@expertenergy.com.br',
      password: 'Admin@2026!',
      role: 'ADMIN',
      name: 'Administrador',
      tenant_id: 'tenant_default',
      tenant_name: 'Expert Energy',
    },
    {
      id: '2',
      email: 'gerente@expertenergy.com.br',
      password: 'Gerente@2026!',
      role: 'BACKOFFICE_MANAGER',
      name: 'Gerente',
      tenant_id: 'tenant_default',
      tenant_name: 'Expert Energy',
    },
    {
      id: '3',
      email: 'analista@expertenergy.com.br',
      password: 'Analista@2026!',
      role: 'BACKOFFICE_ANALYST',
      name: 'Analista',
      tenant_id: 'tenant_default',
      tenant_name: 'Expert Energy',
    },
    {
      id: '4',
      email: 'teste@expertenergy.com.br',
      password: 'ExpertEnergy@2026!',
      role: 'CLIENT',
      name: 'Cliente',
      tenant_id: 'tenant_default',
      tenant_name: 'Expert Energy',
    },
    {
      id: '5',
      email: 'suporte@expertenergy.com.br',
      password: 'Suporte@2026!',
      role: 'SUPPORT',
      name: 'Suporte',
      tenant_id: 'tenant_default',
      tenant_name: 'Expert Energy',
    },
  ];

  constructor(
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
  ) {
    this.logger.log('AuthService initialized with multi-tenant support');
    const userEmails = this.testUsers.map(u => u.email).join(', ');
    this.logger.log('Available test users: ' + userEmails);
  }

  async validateUser(email: string, password: string): Promise<TestUser> {
    this.logger.log('Validating user: ' + email);

    const user = this.testUsers.find(u => u.email === email);

    if (!user) {
      this.logger.warn('User not found: ' + email);
      throw new UnauthorizedException('Email ou senha inválidos');
    }

    const isPasswordValid = password === user.password;

    if (!isPasswordValid) {
      this.logger.warn('Invalid password for: ' + email);
      throw new UnauthorizedException('Email ou senha inválidos');
    }

    this.logger.log('Authentication successful for: ' + email + ' | Tenant: ' + user.tenant_name);
    return user;
  }

  async login(dto: LoginDto) {
    const user = await this.validateUser(dto.email, dto.password);

    const payload = {
      sub: user.id,
      email: user.email,
      role: user.role,
      tenant_id: user.tenant_id,
      tenant_name: user.tenant_name,
    };

    const token = this.jwtService.sign(payload);

    return {
      access_token: token,
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
        name: user.name,
        tenant_id: user.tenant_id,
        tenant_name: user.tenant_name,
      },
    };
  }

  async getProfile(userId: string) {
    const user = this.testUsers.find(u => u.id === userId);

    if (!user) {
      throw new UnauthorizedException('Usuário não encontrado');
    }

    return {
      id: user.id,
      email: user.email,
      role: user.role,
      name: user.name,
      tenant_id: user.tenant_id,
      tenant_name: user.tenant_name,
    };
  }

  async changePassword(userId: string, oldPassword: string, newPassword: string) {
    const user = this.testUsers.find(u => u.id === userId);

    if (!user || user.password !== oldPassword) {
      throw new UnauthorizedException('Senha atual incorreta');
    }

    user.password = newPassword;
    this.logger.log('Password changed for: ' + user.email);

    return {
      success: true,
      message: 'Senha alterada com sucesso',
    };
  }

  async resetPassword(email: string) {
    const user = this.testUsers.find(u => u.email === email);

    if (!user) {
      throw new UnauthorizedException('Email não encontrado');
    }

    this.logger.log('Reset password request for: ' + email);

    return {
      success: true,
      message: 'Email de reset enviado para ' + email,
    };
  }
}
