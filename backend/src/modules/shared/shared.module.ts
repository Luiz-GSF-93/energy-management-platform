import { Module, Logger, Global } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SupabaseService } from '../../services/supabase.service';

const logger = new Logger('SharedModule');

@Global()
@Module({
  // ✅ Não usar TypeOrmModule.forRootAsync aqui
  // Deixar cada módulo que precisar de DB registrar suas entities
  providers: [SupabaseService],
  exports: [SupabaseService],
})
export class SharedModule {
  constructor(private config: ConfigService) {
    const dbUrl = this.config.get<string>('DATABASE_URL');
    logger.log(`DATABASE_URL: ${dbUrl ? '✅ Configurado' : '❌ Não configurado'}`);
    logger.log('✅ SharedModule - TypeORM será adicionado quando DB estiver pronto');
  }
}
