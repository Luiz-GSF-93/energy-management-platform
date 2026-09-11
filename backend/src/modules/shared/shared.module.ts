import { Module, Logger } from '@nestjs/common';
import { TypeOrmModule, TypeOrmModuleOptions } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { SupabaseService } from '../../services/supabase.service';

const logger = new Logger('SharedModule');

@Module({
  imports: [
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: async (config: ConfigService): Promise<TypeOrmModuleOptions> => {
        const databaseUrl = config.get<string>('DATABASE_URL');
        
        logger.log(`DATABASE_URL: ${databaseUrl ? '✅ Configurado' : '❌ Não configurado'}`);

        // ✅ KEY: Usar configuração que NÃO falha na inicialização
        return {
          type: 'postgres',
          url: databaseUrl || 'postgresql://localhost:5432/test', // Fallback localhost
          entities: [],
          synchronize: false,
          logging: false,
          // ✅ Não tentar conectar na inicialização
          dropSchema: false,
          replication: undefined,
          // Usar um pool mínimo
          extra: {
            max: 1,
            min: 0,
            acquireTimeoutMillis: 1000,
          },
        } as TypeOrmModuleOptions;
      },
    }),
  ],
  providers: [SupabaseService],
  exports: [SupabaseService, TypeOrmModule],
})
export class SharedModule {}
