import {Module} from '@nestjs/common';
import {CommonModule} from '../../common/common.module';
import {WhatsappWebhookController,WhatsappDeliveryController,WhatsappTemplatesController} from './whatsapp-delivery.controller';
import {WhatsappTemplatesService} from './whatsapp-templates.service';
import {PlatformCommunicationsController} from './platform-communications.controller';
@Module({imports:[CommonModule],providers:[WhatsappTemplatesService],controllers:[WhatsappWebhookController,WhatsappDeliveryController,WhatsappTemplatesController,PlatformCommunicationsController]})
export class WhatsappDeliveryModule{}
