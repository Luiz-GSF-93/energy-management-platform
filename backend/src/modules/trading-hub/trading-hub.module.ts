import {Module} from '@nestjs/common';

import {CommonModule} from '../../common/common.module';

import {LicensesModule} from '../licenses/licenses.module';

import {TradingHubService} from './trading-hub.service';

import {TradingHubController} from './trading-hub.controller';
import {TradingPortalService} from './trading-portal.service';
import {TradingInvitationsController,TradingPortalController} from './trading-portal.controller';
@Module({imports:[CommonModule,LicensesModule],providers:[TradingHubService,TradingPortalService],controllers:[TradingHubController,TradingInvitationsController,TradingPortalController]})
export class TradingHubModule {}

