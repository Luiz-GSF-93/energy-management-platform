import {CentralSupportThreadService} from './central-support-thread.service';
import {Module} from '@nestjs/common';
import {SupabaseService} from '../../services/supabase.service';
import {PlatformWorkflowsController} from './platform-workflows.controller';
import {PlatformWorkflowsService} from './platform-workflows.service';
import {CentralSupportController,CentralSupportPlatformController} from './central-support.controller';
import {CentralSupportService} from './central-support.service';
@Module({controllers:[PlatformWorkflowsController,CentralSupportController,CentralSupportPlatformController],providers:[CentralSupportThreadService,PlatformWorkflowsService,CentralSupportService,SupabaseService]})
export class PlatformWorkflowsModule{}
