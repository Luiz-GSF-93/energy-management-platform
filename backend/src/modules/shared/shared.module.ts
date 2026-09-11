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
        
        if (!databaseUrl) {
          console.log('⚠️ DATABASE_URL não encontrada. Usando modo de desenvolvimento.');
          return {
            type: 'better-sqlite3',
            database: ':memory:',
            entities: [],
            synchronize: true,
            logging: false,
          };
        }

        return {
          type: 'postgres',
          url: databaseUrl,
          entities: [],
          synchronize: false,
          logging: false,
        };
      },
    }),
  ],
  providers: [SupabaseService],
  exports: [SupabaseService, TypeOrmModule],
})
export class SharedModule {}
