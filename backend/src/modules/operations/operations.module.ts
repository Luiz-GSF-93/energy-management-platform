import {OcrModule} from '../ocr/ocr.module';
import {DiagnosticRequestsService} from './diagnostic-requests.service';
import {Module} from '@nestjs/common';
import {LicensesModule} from '../licenses/licenses.module';
import {SupabaseService} from '../../services/supabase.service';
import {OperationsService} from './operations.service';
import {OperationsController} from './operations.controller';
import {DocumentsService} from '../documents/services/documents.service';
import {ClientEvidenceService} from './client-evidence.service';
import {ClientEvidenceController,PortalEvidenceController} from './client-evidence.controller';
@Module({imports:[LicensesModule,OcrModule],providers:[SupabaseService,OperationsService,DiagnosticRequestsService,DocumentsService,ClientEvidenceService],controllers:[OperationsController,ClientEvidenceController,PortalEvidenceController]})
export class OperationsModule {}
