import {Module} from '@nestjs/common';
import {CceeController} from './ccee.controller';
import {CceeService} from './ccee.service';
import {CceePublicationService} from './ccee-publication.service';
import {SupabaseService} from '../../services/supabase.service';
import {LicensesModule} from '../licenses/licenses.module';
import {CceeRegistrationController} from './ccee-registration.controller';
import {CceeRegistrationService} from './ccee-registration.service';
@Module({imports:[LicensesModule],controllers:[CceeController,CceeRegistrationController],providers:[CceeService,CceePublicationService,CceeRegistrationService,SupabaseService]})
export class CceeModule {}
