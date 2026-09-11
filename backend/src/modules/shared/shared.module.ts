import { Module, Logger } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { SupabaseService } from '../../services/supabase.service';

const logger = new Logger('SharedModule');

@Module({
  imports: [
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const databaseUrl = config.get<string>('DATABASE_URL');
        
        logger.log(`DATABASE_URL: ${databaseUrl ? 'Configurado' : 'Não configurado'}`);

        return {
          type: 'postgres',
          url: databaseUrl || 'postgresql://localhost/test', // Fallback para localhost
          entities: [],
          synchronize: false,
          logging: false,
          // ✅ KEY FIX: Não tentar conectar na inicialização
          retryAttempts: 0,
          keepConnectionAlive: false,
          // Se falhar, continuar assim mesmo
          dropSchema: false,
        };
      },
    }),
  ],
  providers: [SupabaseService],
  exports: [SupabaseService, TypeOrmModule],
})
export class SharedModule {}
