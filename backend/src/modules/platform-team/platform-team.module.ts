import {Module} from '@nestjs/common';
import {SupabaseService} from '../../services/supabase.service';
import {PlatformTeamService} from './platform-team.service';
import {PlatformTeamController} from './platform-team.controller';
@Module({controllers:[PlatformTeamController],providers:[PlatformTeamService,SupabaseService]})
export class PlatformTeamModule{}
