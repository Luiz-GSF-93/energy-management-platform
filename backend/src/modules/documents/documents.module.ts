import { Module } from '@nestjs/common';
import { DocumentsService } from './services/documents.service';
import { DocumentsController } from './controllers/documents.controller';
import { SupabaseService } from '../../services/supabase.service';
import { LicensesModule } from '../licenses/licenses.module';

@Module({
  imports: [LicensesModule],
  controllers: [DocumentsController],
  providers: [DocumentsService, SupabaseService],
  exports: [DocumentsService],
})
export class DocumentsModule {}
