import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';

@Injectable()
export class DocumentAuthService {
  constructor(private jwtService: JwtService) {}

  generateToken(organizationId: string, empresaId: string, userId?: string) {
    const payload = {
      organizationId,
      empresaId,
      userId: userId || `user-${Date.now()}`,
      iat: Math.floor(Date.now() / 1000),
    };

    const token = this.jwtService.sign(payload);
    
    console.log(`🔐 Token gerado para org: ${organizationId}, empresa: ${empresaId}`);
    
    return {
      access_token: token,
      token_type: 'Bearer',
      expires_in: 3600,
      payload,
    };
  }

  validateToken(token: string) {
    try {
      const payload = this.jwtService.verify(token);
      return {
        valid: true,
        payload,
      };
    } catch (error) {
      console.error('❌ Token inválido:', error.message);
      return {
        valid: false,
        error: error.message,
      };
    }
  }

  refreshToken(token: string) {
    const validation = this.validateToken(token);
    
    if (!validation.valid) {
      return {
        valid: false,
        error: 'Token inválido',
      };
    }

    const { organizationId, empresaId, userId } = validation.payload;
    return this.generateToken(organizationId, empresaId, userId);
  }
}
