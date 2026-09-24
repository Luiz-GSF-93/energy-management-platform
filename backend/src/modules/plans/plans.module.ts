import {Module} from '@nestjs/common';
import {CommonModule} from '../../common/common.module';
import {PlansService} from './plans.service';
import {OrganizationPlansController,PlatformPlansController} from './plans.controller';
@Module({imports:[CommonModule],controllers:[OrganizationPlansController,PlatformPlansController],providers:[PlansService]})
export class PlansModule{}
