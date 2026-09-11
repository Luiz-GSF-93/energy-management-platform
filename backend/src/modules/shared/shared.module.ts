import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { SupabaseService } from '../../services/supabase.service';

@Module({
  imports: [
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const databaseUrl = config.get<string>('DATABASE_URL');
        
        // Se não tiver DATABASE_URL, NÃO conectar ao banco
        if (!databaseUrl) {
          console.log('⚠️ DATABASE_URL não configurado. TypeORM desabilidato.');
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
            retryAttempts: 0, // ✅ Não tentar reconectar
            retryDelay: 1000,
          };
        }

        return {
          type: 'postgres',
          url: databaseUrl,
          entities: [],
          synchronize: false,
          logging: false,
          retryAttempts: 3,
          retryDelay: 5000,
        };
      },
    }),
  ],
  providers: [SupabaseService],
  exports: [SupabaseService, TypeOrmModule],
})
export class SharedModule {}
