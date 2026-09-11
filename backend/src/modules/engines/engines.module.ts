import { Module } from '@nestjs/common';
import { SettlementEngine } from './settlement.engine';

@Module({
  providers: [SettlementEngine],
  exports: [SettlementEngine],
})
export class EnginesModule {}
