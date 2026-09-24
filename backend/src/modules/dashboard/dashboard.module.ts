import {Module} from '@nestjs/common';
import {CommonModule} from '../../common/common.module';
import {LicensesModule} from '../licenses/licenses.module';
import {DashboardService} from './dashboard.service';
import {PlatformDashboardController,OrganizationDashboardController} from './dashboard.controller';
@Module({imports:[CommonModule,LicensesModule],controllers:[PlatformDashboardController,OrganizationDashboardController],providers:[DashboardService]})
export class DashboardModule {}
