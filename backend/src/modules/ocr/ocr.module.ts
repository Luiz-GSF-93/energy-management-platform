import {Module} from '@nestjs/common';
import {AzureInvoiceConnector, azureConfig} from './azure-invoice.connector';
/** Export-only foundation. No controller/worker and no outbound call during bootstrap. */
@Module({providers:[{provide:AzureInvoiceConnector,useFactory:()=>new AzureInvoiceConnector(azureConfig(process.env))}],exports:[AzureInvoiceConnector]})
export class OcrModule {}
