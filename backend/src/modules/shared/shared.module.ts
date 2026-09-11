import { Module, Logger } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { SupabaseService } from '../../services/supabase.service';
import { CustomTypeOrmLogger } from './typeorm-logger';

const logger = new Logger('SharedModule');

@Module({
  imports: [
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: async (config: ConfigService) => {
        const databaseUrl = config.get<string>('DATABASE_URL');
        
        if (!databaseUrl) {
          logger.warn('⚠️ DATABASE_URL não configurado. Usando fallback.');
          return {
            type: 'postgres',
            host: 'localhost',
            port: 5432,
            username: 'postgres',
            password: 'postgres',
            database: 'test',
            entities: [],
            synchronize: false,
            logging: false,
            logger: new CustomTypeOrmLogger(),
          };
        }

        logger.log('✅ Conectando ao Supabase PostgreSQL...');

        return {
          type: 'postgres',
          url: databaseUrl,
          entities: [],
          synchronize: false,
          logging: ['error'],
          logger: new CustomTypeOrmLogger(),
          // Connection pooling
          extra: {
            max: 5,
            idleTimeoutMillis: 30000,
            connectionTimeoutMillis: 5000,
          },
          // SSL para Supabase
          ssl: {
            rejectUnauthorized: false,
          },
        };
      },
    }),
  ],
  providers: [SupabaseService],
  exports: [SupabaseService, TypeOrmModule],
})
export class SharedModule {}
