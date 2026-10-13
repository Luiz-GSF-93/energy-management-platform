import {Module} from '@nestjs/common';
import {CommonModule} from '../../common/common.module';
import {PlatformCostsService} from './platform-costs.service';
import {PlatformCostsController} from './platform-costs.controller';
import {PlatformCostsWorker} from './platform-costs.worker';
import {CostServiceCatalogService} from './service-catalog.service';
import {CostServiceCatalogController} from './service-catalog.controller';
@Module({imports:[CommonModule],providers:[CostServiceCatalogService,PlatformCostsService,PlatformCostsWorker],controllers:[CostServiceCatalogController,PlatformCostsController],exports:[PlatformCostsWorker,PlatformCostsService]})
export class PlatformCostsModule {}
