import {Module} from '@nestjs/common';
import {SupabaseService} from '../../services/supabase.service';
import {PlatformCostsModule} from '../platform-costs/platform-costs.module';
import {PlatformAdministrationController} from './platform-administration.controller';
import {PlatformAdministrationService} from './platform-administration.service';
import {PlatformMonitoringService} from './platform-monitoring.service';
@Module({imports:[PlatformCostsModule],controllers:[PlatformAdministrationController],providers:[PlatformAdministrationService,PlatformMonitoringService,SupabaseService]})
export class PlatformAdministrationModule{}
