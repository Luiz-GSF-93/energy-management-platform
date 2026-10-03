import {Module} from '@nestjs/common';
import {LicensesModule} from '../licenses/licenses.module';
import {SupabaseService} from '../../services/supabase.service';
import {OperationsService} from './operations.service';
import {OperationsController} from './operations.controller';
@Module({imports:[LicensesModule],providers:[SupabaseService,OperationsService],controllers:[OperationsController]})
export class OperationsModule {}
