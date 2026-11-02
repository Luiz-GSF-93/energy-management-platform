import {AuditRetentionWorker} from './audit-retention.worker';
import {Module} from '@nestjs/common';
import {SupabaseService} from '../../services/supabase.service';
import {AuditWorkspaceService} from './audit.service';
import {AuditCaptureMiddleware} from './audit.middleware';
import {OrganizationAuditController,GlobalAuditController} from './audit.controller';
@Module({controllers:[OrganizationAuditController,GlobalAuditController],providers:[SupabaseService,AuditWorkspaceService,AuditCaptureMiddleware,AuditRetentionWorker],exports:[AuditCaptureMiddleware,AuditWorkspaceService]})
export class AuditModule{}
