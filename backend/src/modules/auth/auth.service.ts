import { Injectable, UnauthorizedException, Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class AuthService {
  private readonly logger = new Logger('AuthService');

  private readonly testUsers = [
    { 
      id: '1', 
      email: 'admin@expertenergy.com.br', 
      password: 'Admin@2026!',
      role: 'ADMIN', 
      name: 'Administrador' 
    },
    { 
      id: '2', 
      email: 'gerente@expertenergy.com.br', 
      password: 'Gerente@2026!',
      role: 'BACKOFFICE_MANAGER', 
      name: 'Gerente' 
    },
    { 
      id: '3', 
      email: 'analista@expertenergy.com.br', 
      password: 'Analista@2026!',
      role: 'BACKOFFICE_ANALYST', 
      name: 'Analista' 
    },
    { 
      id: '4', 
      email: 'teste@expertenergy.com.br', 
      password: 'ExpertEnergy@2026!',
      role: 'CLIENT', 
      name: 'Cliente' 
    },
    { 
      id: '5', 
      email: 'suporte@expertenergy.com.br', 
      password: 'Suporte@2026!',
      role: 'SUPPORT', 
      name: 'Suporte' 
    },
  ];

  constructor(
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
  ) {
    this.logger.log(`✅ AuthService initialized`);
    this.logger.log(`📋 Available users: ${this.testUsers.map(u => u.email).join(', ')}`);
  }

  async validateUser(email: string, password: string) {
    this.logger.log(`🔍 Validating user: ${email}`);
    
    const user = this.testUsers.find(u => u.email === email);
    
    if (!user) {
      this.logger.warn(`❌ User not found: ${email}`);
      this.logger.warn(`📋 Available users: ${this.testUsers.map(u => u.email).join(', ')}`);
      throw new UnauthorizedException('Email ou senha inválidos');
    }

    this.logger.log(`✅ User found: ${email}`);
    this.logger.debug(`Expected password: "${user.password}"`);
    this.logger.debug(`Received password: "${password}"`);

    const isPasswordValid = password === user.password;
    
    if (!isPasswordValid) {
      this.logger.warn(`❌ Invalid password for: ${email}`);
      throw new UnauthorizedException('Email ou senha inválidos');
    }

    this.logger.log(`✅ Authentication successful for: ${email}`);
    return user;
  }

  async login(email: string, password: string) {
    const user = await this.validateUser(email, password);

    const payload = {
      sub: user.id,
      email: user.email,
      role: user.role,
    };

    const token = this.jwtService.sign(payload);

    return {
      access_token: token,
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
        name: user.name,
      },
    };
  }

  async changePassword(userId: string, oldPassword: string, newPassword: string) {
    const user = this.testUsers.find(u => u.id === userId);
    
    if (!user || user.password !== oldPassword) {
      throw new UnauthorizedException('Senha atual incorreta');
    }

    user.password = newPassword;

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

    return {
      success: true,
      message: 'Email de reset enviado para ' + email,
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
    };
  }
}
