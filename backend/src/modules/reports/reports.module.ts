import {Module} from '@nestjs/common';
import {ReportsController} from './reports.controller';
import {ReportsService} from './reports.service';
import {SupabaseService} from '../../services/supabase.service';
import {ContractsModule} from '../contracts/contracts.module';
import {LicensesModule} from '../licenses/licenses.module';
@Module({imports:[ContractsModule,LicensesModule],controllers:[ReportsController],providers:[ReportsService,SupabaseService],exports:[ReportsService]})
export class ReportsModule {}
