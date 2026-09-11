import { Module } from '@nestjs/common';
import { SettlementController } from './controllers/settlements.controller';
import { EnginesModule } from '../engines/engines.module';

@Module({
  imports: [EnginesModule],
  controllers: [SettlementController],
})
export class SettlementsModule {}
