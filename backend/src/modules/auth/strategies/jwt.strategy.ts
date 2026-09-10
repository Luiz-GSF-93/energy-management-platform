import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';

export interface JwtPayload {
  sub: string;
  email: string;
  iat?: number;
  exp?: number;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(configService: ConfigService) {
    const secret = configService.get<string>('JWT_SECRET');
    
    if (!secret) {
      throw new Error('JWT_SECRET not configured');
    }

    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: secret,
    });
  }

  /**
   * Passport invoca este método com o payload decodificado do JWT.
   * O retorno será anexado a req.user e passado ao @CurrentUser() decorator.
   */
  async validate(payload: JwtPayload): Promise<JwtPayload> {
    console.log('✅ JwtStrategy.validate() - Payload recebido:', {
      sub: payload.sub,
      email: payload.email,
    });
    
    // Retornar o payload completo para que @CurrentUser() receba { sub, email, iat, exp }
    return payload;
  }
}
