import { Module } from '@nestjs/common';
import { ConsumerUnitsService } from './services/consumer-units.service';
import { ConsumerUnitsController } from './controllers/consumer-units.controller';
import { SupabaseService } from '../../services/supabase.service';

@Module({
  controllers: [ConsumerUnitsController],
  providers: [ConsumerUnitsService, SupabaseService],
  exports: [ConsumerUnitsService],
})
export class ConsumerUnitsModule {}
