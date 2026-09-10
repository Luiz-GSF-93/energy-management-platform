import { Injectable, UnauthorizedException, InternalServerErrorException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { SupabaseService } from '../../services/supabase.service';
import { LoginDto, RegisterDto } from './dto/auth.dto';

@Injectable()
export class AuthService {
  constructor(
    private jwtService: JwtService,
    private supabaseService: SupabaseService,
  ) {}

  async register(registerDto: RegisterDto) {
    const { email, password, name } = registerDto;

    try {
      const { data, error } = await this.supabaseService
        .getClient()
        .auth.signUp({
          email,
          password,
          options: {
            data: { name },
          },
        });

      if (error) {
        console.error('❌ Erro ao registrar:', error);
        throw new UnauthorizedException(error.message);
      }

      return {
        message: 'Usuário criado com sucesso. Verifique seu email.',
        user: data.user,
      };
    } catch (exception) {
      console.error('❌ Exceção ao registrar:', exception);
      throw new InternalServerErrorException('Erro ao registrar usuário');
    }
  }

  async login(loginDto: LoginDto) {
    const { email, password } = loginDto;

    try {
      console.log(`🔐 Tentando login com email: ${email}`);
      
      const { data, error } = await this.supabaseService
        .getClient()
        .auth.signInWithPassword({
          email,
          password,
        });

      if (error) {
        console.error('❌ Erro ao fazer login:', error);
        throw new UnauthorizedException('Credenciais inválidas');
      }

      console.log('✅ Login bem-sucedido, gerando token JWT');

      // Gerar JWT com signOptions explícitos
      const token = this.jwtService.sign(
        {
          sub: data.user.id,
          email: data.user.email,
        },
        {
          expiresIn: '7d', // Explicitamente 7 dias
          secret: process.env.JWT_SECRET || 'your-secret-key-change-in-production',
        }
      );

      console.log('✅ Token JWT gerado com sucesso');

      return {
        access_token: token,
        user: {
          id: data.user.id,
          email: data.user.email,
        },
      };
    } catch (exception) {
      console.error('❌ Exceção ao fazer login:', exception);
      if (exception instanceof UnauthorizedException) {
        throw exception;
      }
      throw new InternalServerErrorException('Erro ao fazer login: ' + String(exception));
    }
  }

  async validateToken(token: string) {
    try {
      const payload = this.jwtService.verify(token);
      return payload;
    } catch (exception) {
      console.error('❌ Erro ao validar token:', exception);
      throw new UnauthorizedException('Token inválido');
    }
  }
}
