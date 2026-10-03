import {OcrModule} from '../ocr/ocr.module';
import {DiagnosticRequestsService} from './diagnostic-requests.service';
import {Module} from '@nestjs/common';
import {LicensesModule} from '../licenses/licenses.module';
import {SupabaseService} from '../../services/supabase.service';
import {OperationsService} from './operations.service';
import {OperationsController} from './operations.controller';
@Module({imports:[LicensesModule,OcrModule],providers:[SupabaseService,OperationsService,DiagnosticRequestsService],controllers:[OperationsController]})
export class OperationsModule {}
