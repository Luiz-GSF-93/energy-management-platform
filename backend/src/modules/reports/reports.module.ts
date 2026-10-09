import {InvestmentsService} from './investments.service';
import {InvestmentsController} from './investments.controller';
import {Module} from '@nestjs/common';
import {EnergyForecastModule} from '../energy-forecast/energy-forecast.module';
import {ReportsController} from './reports.controller';
import {ReportsService} from './reports.service';
import {SupabaseService} from '../../services/supabase.service';
import {ContractsModule} from '../contracts/contracts.module';
import {LicensesModule} from '../licenses/licenses.module';
import {ReportPolicyController} from './report-policy.controller';
import {ReportPolicyService} from './report-policy.service';
import {ReportPreparationWorker} from './report-preparation.worker';
import {ReportDeliveryWorker} from './report-delivery.worker';
@Module({imports:[ContractsModule,LicensesModule,EnergyForecastModule],controllers:[InvestmentsController,ReportsController,ReportPolicyController],providers:[InvestmentsService,ReportsService,ReportPolicyService,ReportPreparationWorker,ReportDeliveryWorker,SupabaseService],exports:[ReportsService]})
export class ReportsModule {}
