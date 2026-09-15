import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { ConfigService } from '@nestjs/config';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { JwtStrategy } from './strategies/jwt.strategy';
import { SupabaseService } from '../../services/supabase.service';

@Module({
  imports: [
    PassportModule,
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => {
        const secret = configService.get<string>('JWT_SECRET') || 'energy-secret-key-2026';
        // Converte para segundos: 7 dias = 604800 segundos
        const expiresInStr = configService.get<string>('JWT_EXPIRES_IN') || '7d';
        const expiresIn = this.parseExpiresIn(expiresInStr);
        
        console.log('🔐 JWT Config:', { secret: secret.substring(0, 10) + '...', expiresIn });
        
        return {
          secret,
          signOptions: { 
            expiresIn, // número em segundos
          },
        };
      },
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, JwtStrategy, SupabaseService],
  exports: [AuthService],
})
export class AuthModule {
  private static parseExpiresIn(expiresIn: string): number {
    const match = expiresIn.match(/^(\d+)([smhd])$/);
    if (!match) return 604800; // 7 dias padrão
    
    const value = parseInt(match[1], 10);
    const unit = match[2];
    
    switch (unit) {
      case 's': return value;
      case 'm': return value * 60;
      case 'h': return value * 3600;
      case 'd': return value * 86400;
      default: return 604800;
    }
  }
}
