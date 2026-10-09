import {Module} from '@nestjs/common';
import {CommonModule} from '../../common/common.module';
import {PortalLicenseService} from './portal-license.service';
import {PortalLicenseGuard} from './portal-license.guard';
import {PortalLicenseController,ClientPortalLicenseController} from './portal-license.controller';
@Module({imports:[CommonModule],controllers:[PortalLicenseController,ClientPortalLicenseController],providers:[PortalLicenseService,PortalLicenseGuard],exports:[PortalLicenseService,PortalLicenseGuard]})
export class PortalLicenseModule{}
