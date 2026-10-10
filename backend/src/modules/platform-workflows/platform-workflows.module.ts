import {Module} from '@nestjs/common';
import {SupabaseService} from '../../services/supabase.service';
import {PlatformWorkflowsController} from './platform-workflows.controller';
import {PlatformWorkflowsService} from './platform-workflows.service';
@Module({controllers:[PlatformWorkflowsController],providers:[PlatformWorkflowsService,SupabaseService]})
export class PlatformWorkflowsModule{}
