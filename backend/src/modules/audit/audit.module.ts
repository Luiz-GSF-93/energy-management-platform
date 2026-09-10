import { Module } from '@nestjs/common';
import { AuditService } from './services/audit.service';
import { AuditController } from './controllers/audit.controller';
import { SupabaseService } from '../../services/supabase.service';

@Module({
  controllers: [AuditController],
  providers: [AuditService, SupabaseService],
  exports: [AuditService],
})
export class AuditModule {}
