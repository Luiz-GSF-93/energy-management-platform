import {Module} from '@nestjs/common';
import {CommonModule} from '../../common/common.module';
import {CoreLicenseService} from './core-license.service';
import {CoreLicenseController} from './core-license.controller';
import {AdminModule} from '../admin/admin.module';
import {CoreWelcomeService} from './core-welcome.service';
@Module({imports:[CommonModule,AdminModule],controllers:[CoreLicenseController],providers:[CoreLicenseService,CoreWelcomeService]})
export class CoreLicenseModule{}
