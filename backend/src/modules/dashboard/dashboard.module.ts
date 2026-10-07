import {Module} from '@nestjs/common';
import {CommonModule} from '../../common/common.module';
import {LicensesModule} from '../licenses/licenses.module';
import {DashboardService} from './dashboard.service';
import {PlatformDashboardController,OrganizationDashboardController,IntegrationRenewalController} from './dashboard.controller';
import {IntegrationRenewalService} from './integration-renewal.service';
@Module({imports:[CommonModule,LicensesModule],controllers:[PlatformDashboardController,OrganizationDashboardController,IntegrationRenewalController],providers:[DashboardService,IntegrationRenewalService]})
export class DashboardModule {}
