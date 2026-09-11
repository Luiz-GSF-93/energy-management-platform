import { Module, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SupabaseService } from '../../services/supabase.service';

const logger = new Logger('SharedModule');

@Module({
  providers: [SupabaseService],
  exports: [SupabaseService],
})
export class SharedModule implements OnModuleInit {
  constructor(private configService: ConfigService) {}

  onModuleInit() {
    const databaseUrl = this.configService.get<string>('DATABASE_URL');
    
    if (databaseUrl) {
      logger.log('✅ DATABASE_URL configurado. TypeORM pronto para integração.');
      logger.log('📝 DB: Supabase PostgreSQL');
    } else {
      logger.warn('⚠️ DATABASE_URL não configurado. Usando modo em memória (MVP).');
    }
  }
}
