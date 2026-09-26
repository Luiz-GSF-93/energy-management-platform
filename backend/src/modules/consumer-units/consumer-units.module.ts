import {DemandPeriodsService} from './services/demand-periods.service';
import {DemandPeriodsController} from './controllers/demand-periods.controller';
import { Module } from '@nestjs/common';
import { ConsumerUnitsService } from './services/consumer-units.service';
import { ConsumerUnitsController } from './controllers/consumer-units.controller';
import { SupabaseService } from '../../services/supabase.service';

@Module({
  controllers: [ConsumerUnitsController,DemandPeriodsController],
  providers: [ConsumerUnitsService, SupabaseService,DemandPeriodsService],
  exports: [ConsumerUnitsService],
})
export class ConsumerUnitsModule {}
