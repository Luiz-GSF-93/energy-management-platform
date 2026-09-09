import { Module } from '@nestjs/common';
import { ContractsService } from './services/contracts.service';
import { ContractsController } from './controllers/contracts.controller';
import { SupabaseService } from '../../services/supabase.service';

@Module({
  controllers: [ContractsController],
  providers: [ContractsService, SupabaseService],
  exports: [ContractsService],
})
export class ContractsModule {}
