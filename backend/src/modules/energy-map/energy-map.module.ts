import {Module} from '@nestjs/common';
import {SupabaseService} from '../../services/supabase.service';
import {LicensesModule} from '../licenses/licenses.module';
import {EnergyMapService} from './energy-map.service';
import {EnergyMapController} from './energy-map.controller';
@Module({imports:[LicensesModule],providers:[SupabaseService,EnergyMapService],controllers:[EnergyMapController]})
export class EnergyMapModule {}
