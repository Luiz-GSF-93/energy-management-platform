import {TeamPasswordService} from './team-password.service';
import {TeamPasswordController} from './team-password.controller';
import {Module} from '@nestjs/common';
import {SupabaseService} from '../../services/supabase.service';
import {PlatformTeamService} from './platform-team.service';
import {TeamNotificationService} from './team-notification.service';
import {TeamNotificationController,TeamNotificationWebhookController,TeamNotificationMetricsController} from './team-notification.controller';
import {PlatformTeamController} from './platform-team.controller';
@Module({controllers:[TeamPasswordController,PlatformTeamController,TeamNotificationController,TeamNotificationWebhookController,TeamNotificationMetricsController],providers:[TeamPasswordService,PlatformTeamService,TeamNotificationService,SupabaseService]})
export class PlatformTeamModule{}
