import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { SupabaseService } from '../../services/supabase.service';

// Importar apenas as entidades que existem
import { Contract } from '../contracts/entities/contract.entity';
import { Fee } from '../management-fees/entities/fee.entity';
import { Approval } from '../approvals/entities/approval.entity';

@Module({
  imports: [
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => {
        const databaseUrl = configService.get('DATABASE_URL');
        return {
          type: 'postgres',
          url: databaseUrl,
          entities: [Contract, Fee, Approval],
          synchronize: process.env.NODE_ENV !== 'production',
          logging: process.env.NODE_ENV === 'development',
          ssl: { rejectUnauthorized: false },
        };
      },
    }),
  ],
  providers: [SupabaseService],
  exports: [SupabaseService],
})
export class SharedModule {}
