import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { ConfigService } from '@nestjs/config';
import { AuthService } from './auth.service';
import { PasswordRecoveryController } from './password-recovery.controller';
import { PasswordRecoveryService } from './password-recovery.service';
import { AuthController } from './auth.controller';
import { JwtStrategy } from './strategies/jwt.strategy';
import { SupabaseService } from '../../services/supabase.service';
import { CommonModule } from '../../common/common.module';

// Helper para converter string de expiração em segundos
function parseExpiresIn(expiresIn: string): number {
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

@Module({
  imports: [
    CommonModule,
    PassportModule,
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => {
        const secret = configService.get<string>('JWT_SECRET');

        if (!secret) {
          throw new Error('JWT_SECRET not configured');
        }
        const expiresInStr = configService.get<string>('JWT_EXPIRES_IN') || '7d';
        const expiresIn = parseExpiresIn(expiresInStr);
        
        
        return {
          secret,
          signOptions: { 
            expiresIn,
          },
        };
      },
    }),
  ],
  controllers: [AuthController, PasswordRecoveryController],
  providers: [PasswordRecoveryService, AuthService, JwtStrategy, SupabaseService],
  exports: [AuthService],
})
export class AuthModule {}
