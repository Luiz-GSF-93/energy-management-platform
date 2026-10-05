import {Module} from '@nestjs/common';
import {CommonModule} from '../../common/common.module';
import {PlatformCostsService} from './platform-costs.service';
import {PlatformCostsController} from './platform-costs.controller';
import {PlatformCostsWorker} from './platform-costs.worker';
@Module({imports:[CommonModule],providers:[PlatformCostsService,PlatformCostsWorker],controllers:[PlatformCostsController],exports:[PlatformCostsWorker]})
export class PlatformCostsModule {}
