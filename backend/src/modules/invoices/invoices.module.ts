import { Module } from '@nestjs/common';
import { InvoicesService } from './services/invoices.service';
import { InvoicesController } from './controllers/invoices.controller';
import { SupabaseService } from '../../services/supabase.service';
import { SettlementEngine } from '../engines/settlement.engine';

@Module({
  controllers: [InvoicesController],
  providers: [InvoicesService, SupabaseService, SettlementEngine],
  exports: [InvoicesService],
})
export class InvoicesModule {}
