import { BadRequestException, HttpException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SupabaseService } from '../../services/supabase.service';

@Injectable()
export class PasswordRecoveryService {
  private readonly logger = new Logger(PasswordRecoveryService.name);
  private readonly attempts = new Map<string, { count: number; until: number }>();

  constructor(private readonly supabase: SupabaseService, private readonly config: ConfigService) {}

  private limit(action: 'request' | 'complete', ip: string) {
    const now = Date.now();
    for (const [key, value] of this.attempts) {
      if (value.until <= now) this.attempts.delete(key);
    }
    const key = action + ':' + ip;
    const entry = this.attempts.get(key) || { count: 0, until: now + 60_000 };
    if (entry.count >= (action === 'request' ? 5 : 10) || (!this.attempts.has(key) && this.attempts.size >= 10_000)) {
      throw new HttpException('Muitas tentativas. Aguarde um minuto e tente novamente.', 429);
    }
    entry.count++;
    this.attempts.set(key, entry);
  }

  async request(email: string, ip: string) {
    this.limit('request', ip);
    // The destination is server configuration, never a user-provided redirect.
    const origin = this.config.get<string>('FRONTEND_URL') || 'https://app.expertenergy.com.br';
    const redirectTo = new URL('/auth/reset-password', origin).toString();
    try {
      const { error } = await this.supabase.createAuthClient().auth.resetPasswordForEmail(email, { redirectTo });
      if (error) this.logger.warn('Recovery email provider did not confirm dispatch');
    } catch {
      this.logger.warn('Recovery email provider unavailable');
    }
    // Same response for existing and unknown addresses; no provider details or PII.
    return { message: 'Se houver uma conta para este e-mail, você receberá um link para redefinir sua senha. Verifique também a pasta de spam.' };
  }

  async complete(tokenHash: string, password: string, ip: string) {
    this.limit('complete', ip);
    const client = this.supabase.createAuthClient();
    let verified = false;
    try {
      const { data, error } = await client.auth.verifyOtp({ token_hash: tokenHash, type: 'recovery' });
      if (error || !data?.session || !data?.user) {
        throw new BadRequestException('Link inválido, expirado ou já utilizado. Solicite um novo link.');
      }
      verified = true;
      // updateUser uses ONLY the isolated session proved by the recovery token.
      const update = await client.auth.updateUser({ password });
      if (update.error) {
        throw new BadRequestException('Não foi possível alterar a senha. Use uma senha diferente e solicite um novo link.');
      }
      return { success: true };
    } catch (error) {
      if (error instanceof BadRequestException) throw error;
      throw new BadRequestException('Não foi possível concluir a recuperação. Solicite um novo link e tente novamente.');
    } finally {
      if (verified) {
        try {
          const { error } = await client.auth.signOut({ scope: 'global' });
          if (error) this.logger.warn('Recovery session revocation could not be confirmed');
        } catch {
          this.logger.warn('Recovery session revocation unavailable');
        }
      }
    }
  }
}
