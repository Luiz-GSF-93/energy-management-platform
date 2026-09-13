import { Module, Logger, Global } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SupabaseService } from '../../services/supabase.service';

const logger = new Logger('SharedModule');

@Global()
@Module({
  providers: [SupabaseService],
  exports: [SupabaseService],
})
export class SharedModule {
  constructor(private config: ConfigService) {
    const dbUrl = this.config.get<string>('DATABASE_URL');
    logger.log(`DATABASE_URL: ${dbUrl ? '✅ Configurado' : '❌ Não configurado'}`);
    logger.log('✅ SharedModule inicializado com sucesso!');
  }
}
