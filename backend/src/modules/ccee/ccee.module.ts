import {Module} from '@nestjs/common';
import {CceeController} from './ccee.controller';
import {CceeService} from './ccee.service';
import {CceePublicationService} from './ccee-publication.service';
import {SupabaseService} from '../../services/supabase.service';
@Module({controllers:[CceeController],providers:[CceeService,CceePublicationService,SupabaseService]})
export class CceeModule {}
