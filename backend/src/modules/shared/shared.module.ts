import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';

@Module({
  imports: [
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        // Se não tiver DATABASE_URL, usar um banco mock/em memória
        const databaseUrl = config.get<string>('DATABASE_URL');
        
        if (!databaseUrl) {
          console.log('⚠️ DATABASE_URL não encontrada. Usando modo de desenvolvimento.');
          // Modo desenvolvimento: sem conexão ao banco
          return {
            type: 'better-sqlite3',
            database: ':memory:',
            entities: [],
            synchronize: true,
            logging: false,
          };
        }

        // Modo produção: conecta ao Supabase
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
  providers: [],
  exports: [],
})
export class SharedModule {}
