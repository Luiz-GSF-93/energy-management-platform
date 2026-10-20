import {Module} from '@nestjs/common';
import {CceeController} from './ccee.controller';
import {CceeService} from './ccee.service';
import {CceePublicationService} from './ccee-publication.service';
import {SupabaseService} from '../../services/supabase.service';
import {LicensesModule} from '../licenses/licenses.module';
import {CceeRegistrationController} from './ccee-registration.controller';
import {CceeRegistrationService} from './ccee-registration.service';
import {CceeDataService} from './ccee-data.service';
import {CceePrivateConnector} from './ccee-private.connector';
import {CceeDriConnector} from './ccee-dri.connector';
import {CceeDriService} from './ccee-dri.service';
import {CceeDriController} from './ccee-dri.controller';
import {CceeDataWorker} from './ccee-data.worker';
import {CceeDataController,CceeCalendarController,CceeDataMetricsController} from './ccee-data.controller';
@Module({imports:[LicensesModule],controllers:[CceeController,CceeRegistrationController,CceeDataController,CceeCalendarController,CceeDataMetricsController,CceeDriController],providers:[CceeService,CceePublicationService,CceeRegistrationService,CceeDataService,CceePrivateConnector,CceeDriConnector,CceeDriService,CceeDataWorker,SupabaseService],exports:[CceeDataService,CceeDriService]})
export class CceeModule {}
