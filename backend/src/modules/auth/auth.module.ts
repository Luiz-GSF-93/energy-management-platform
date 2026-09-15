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
        const expiresIn = configService.get<number | string>('JWT_EXPIRES_IN') || '7d';
        
        console.log('🔐 JWT Config:', { secret: secret.substring(0, 10) + '...', expiresIn });
        
        return {
          secret,
          signOptions: { 
            expiresIn: expiresIn as string | number, // type assertion
          },
        };
      },
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, JwtStrategy, SupabaseService],
  exports: [AuthService],
})
export class AuthModule {}
