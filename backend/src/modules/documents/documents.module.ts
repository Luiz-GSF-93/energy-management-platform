import {DocumentCatalogService} from './services/document-catalog.service';
import {DocumentCatalogController} from './controllers/document-catalog.controller';
import { Module } from '@nestjs/common';
import { DocumentsService } from './services/documents.service';
import { DocumentsController } from './controllers/documents.controller';
import { SupabaseService } from '../../services/supabase.service';
import { LicensesModule } from '../licenses/licenses.module';

@Module({
  imports: [LicensesModule],
  controllers: [DocumentsController,DocumentCatalogController],
  providers: [DocumentsService, DocumentCatalogService, SupabaseService],
  exports: [DocumentsService],
})
export class DocumentsModule {}
