import { Module } from '@nestjs/common';
import { ManagementFeesController } from './controllers/management-fees.controller';
import { ManagementFeesService } from './services/management-fees.service';
import { SupabaseService } from '../../services/supabase.service';

@Module({
  controllers: [ManagementFeesController],
  providers: [ManagementFeesService, SupabaseService],
  exports: [ManagementFeesService],
})
export class ManagementFeesModule {}
