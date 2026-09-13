import { Module, Logger, Global } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { SupabaseService } from '../../services/supabase.service';

const logger = new Logger('SharedModule');

@Global()
@Module({
  imports: [ConfigModule],
  providers: [SupabaseService],
  exports: [SupabaseService, ConfigService],
})
export class SharedModule {
  constructor(private config: ConfigService) {
    const dbUrl = this.config.get<string>('DATABASE_URL');
    logger.log(`DATABASE_URL: ${dbUrl ? '✅ Configurado' : '❌ Não configurado'}`);
    logger.log('✅ SharedModule inicializado com sucesso!');
  }
}
