import { Module } from '@nestjs/common';
import { InvoicesService } from './services/invoices.service';
import { InvoicesController } from './controllers/invoices.controller';
import { SupabaseService } from '../../services/supabase.service';

@Module({
  controllers: [InvoicesController],
  providers: [InvoicesService, SupabaseService],
  exports: [InvoicesService],
})
export class InvoicesModule {}
