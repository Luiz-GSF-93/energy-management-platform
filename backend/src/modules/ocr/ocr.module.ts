import {OcrMonthlyIntegrationService} from './ocr-monthly-integration.service';
import {OcrMonthlyIntegrationController} from './ocr-monthly-integration.controller';
import {Module} from '@nestjs/common';
import {CommonModule} from '../../common/common.module';
import {LicensesModule} from '../licenses/licenses.module';
import {AzureInvoiceConnector,azureConfig} from './azure-invoice.connector';
import {OcrDemandReviewService} from './ocr-demand-review.service';
import {OcrReviewService} from './ocr-review.service';
import {OcrIdentityReviewService} from './ocr-identity-review.service';
import {OcrIdentityService} from './ocr-identity.service';
import {OcrQueueService} from './ocr-queue.service';
import {OcrWorker} from './ocr.worker';
import {OcrController} from './ocr.controller';
@Module({imports:[CommonModule,LicensesModule],providers:[{provide:AzureInvoiceConnector,useFactory:()=>new AzureInvoiceConnector(azureConfig(process.env))},OcrMonthlyIntegrationService,OcrQueueService,OcrWorker,OcrReviewService,OcrDemandReviewService,OcrIdentityService,OcrIdentityReviewService],controllers:[OcrController,OcrMonthlyIntegrationController],exports:[OcrQueueService]})
export class OcrModule {}
