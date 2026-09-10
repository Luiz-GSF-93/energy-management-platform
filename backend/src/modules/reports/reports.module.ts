import { Module } from '@nestjs/common';
import { ReportsService } from './services/reports.service';
import { ReportsController } from './controllers/reports.controller';
import { SupabaseService } from '../../services/supabase.service';

@Module({
  controllers: [ReportsController],
  providers: [ReportsService, SupabaseService],
  exports: [ReportsService],
})
export class ReportsModule {}
