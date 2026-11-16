import {Module} from '@nestjs/common';
import {TradingClientMonitorService} from './trading-client-monitor.service';
import {TradingClientMonitorController,TradingClientMonitorPublicController} from './trading-client-monitor.controller';
import {TradingCommunicationService} from './trading-communication.service';
import {TradingCommunicationController,TradingQuoteConversationController} from './trading-communication.controller';

import {CommonModule} from '../../common/common.module';

import {LicensesModule} from '../licenses/licenses.module';

import {TradingHubService} from './trading-hub.service';

import {TradingHubController} from './trading-hub.controller';
import {TradingPortalService} from './trading-portal.service';
import {TradingInvitationsController,TradingPortalController} from './trading-portal.controller';
import {TradingWorkflowService} from './trading-workflow.service';
import {TradingWorkflowController,TradingClientApprovalController,TradingFormalizationController,TradingSupplierFileAuthorization} from './trading-workflow.controller';
import {TradingWorkflowWorker} from './trading-workflow.worker';
import {WhatsappTemplatesService} from '../whatsapp-delivery/whatsapp-templates.service';
@Module({imports:[CommonModule,LicensesModule],providers:[TradingClientMonitorService,TradingCommunicationService,TradingHubService,TradingPortalService,TradingWorkflowService,TradingWorkflowWorker,TradingSupplierFileAuthorization,WhatsappTemplatesService],controllers:[TradingClientMonitorController,TradingClientMonitorPublicController,TradingCommunicationController,TradingQuoteConversationController,TradingHubController,TradingInvitationsController,TradingPortalController,TradingWorkflowController,TradingClientApprovalController,TradingFormalizationController]})
export class TradingHubModule {}

