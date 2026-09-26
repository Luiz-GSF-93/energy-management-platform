import {Module} from '@nestjs/common';
import {CommonModule} from '../../common/common.module';
import {LicensesModule} from '../licenses/licenses.module';
import {AzureInvoiceConnector,azureConfig} from './azure-invoice.connector';
import {OcrReviewService} from './ocr-review.service';
import {OcrQueueService} from './ocr-queue.service';
import {OcrWorker} from './ocr.worker';
import {OcrController} from './ocr.controller';
@Module({imports:[CommonModule,LicensesModule],providers:[{provide:AzureInvoiceConnector,useFactory:()=>new AzureInvoiceConnector(azureConfig(process.env))},OcrQueueService,OcrWorker,OcrReviewService],controllers:[OcrController],exports:[OcrQueueService]})
export class OcrModule {}
