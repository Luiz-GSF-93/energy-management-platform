import {Module} from '@nestjs/common';

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
@Module({imports:[CommonModule,LicensesModule],providers:[TradingHubService,TradingPortalService,TradingWorkflowService,TradingWorkflowWorker,TradingSupplierFileAuthorization,WhatsappTemplatesService],controllers:[TradingHubController,TradingInvitationsController,TradingPortalController,TradingWorkflowController,TradingClientApprovalController,TradingFormalizationController]})
export class TradingHubModule {}

