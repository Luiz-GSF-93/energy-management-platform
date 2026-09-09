import { Module } from '@nestjs/common';
import { SettlementService } from './services/settlement.service';
import { ConsumptionHistoryService } from './services/consumption-history.service';
import { TariffService } from './services/tariff.service';
import { ForecastService } from './services/forecast.service';
import { SettlementController } from './controllers/settlement.controller';
import { ConsumptionHistoryController } from './controllers/consumption-history.controller';
import { TariffController } from './controllers/tariff.controller';
import { ForecastController } from './controllers/forecast.controller';
import { SupabaseService } from '../../services/supabase.service';

@Module({
  controllers: [
    SettlementController,
    ConsumptionHistoryController,
    TariffController,
    ForecastController,
  ],
  providers: [
    SettlementService,
    ConsumptionHistoryService,
    TariffService,
    ForecastService,
    SupabaseService,
  ],
  exports: [
    SettlementService,
    ConsumptionHistoryService,
    TariffService,
    ForecastService,
  ],
})
export class SettlementsModule {}
