import { Module } from '@nestjs/common';
import { AclAdmissionController, AclAdmissionPortalController } from './acl-admission.controller';
import { AclAdmissionService } from './acl-admission.service';
import { LicensesModule } from '../licenses/licenses.module';
import { SupabaseService } from '../../services/supabase.service';
@Module({ imports: [LicensesModule], controllers: [AclAdmissionController, AclAdmissionPortalController], providers: [AclAdmissionService, SupabaseService] })
export class AclAdmissionsModule {}
