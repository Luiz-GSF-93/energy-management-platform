import { Module } from '@nestjs/common';
import { DocumentsService } from './services/documents.service';
import { DocumentsController } from './controllers/documents.controller';
import { SupabaseService } from '../../services/supabase.service';

@Module({
  controllers: [DocumentsController],
  providers: [DocumentsService, SupabaseService],
  exports: [DocumentsService],
})
export class DocumentsModule {}
