import {Module} from '@nestjs/common';
import {ReportsController} from './reports.controller';
import {ReportsService} from './reports.service';
import {SupabaseService} from '../../services/supabase.service';
import {ContractsModule} from '../contracts/contracts.module';
import {LicensesModule} from '../licenses/licenses.module';
import {ReportPolicyController} from './report-policy.controller';
import {ReportPolicyService} from './report-policy.service';
import {ReportPreparationWorker} from './report-preparation.worker';
import {ReportDeliveryWorker} from './report-delivery.worker';
@Module({imports:[ContractsModule,LicensesModule],controllers:[ReportsController,ReportPolicyController],providers:[ReportsService,ReportPolicyService,ReportPreparationWorker,ReportDeliveryWorker,SupabaseService],exports:[ReportsService]})
export class ReportsModule {}
