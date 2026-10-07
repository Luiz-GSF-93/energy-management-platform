import {Module} from '@nestjs/common';
import {CommonModule} from '../../common/common.module';
import {WhatsappWebhookController,WhatsappDeliveryController} from './whatsapp-delivery.controller';
@Module({imports:[CommonModule],controllers:[WhatsappWebhookController,WhatsappDeliveryController]})
export class WhatsappDeliveryModule{}
