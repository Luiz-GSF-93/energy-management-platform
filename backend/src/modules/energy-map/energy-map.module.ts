import {Module} from '@nestjs/common';
import {SupabaseService} from '../../services/supabase.service';
import {LicensesModule} from '../licenses/licenses.module';
import {EnergyMapService} from './energy-map.service';
import {EnergyMapController} from './energy-map.controller';
import {PlatformEnergyMapController} from './platform-energy-map.controller';
import {PlatformEnergyMapService} from './platform-energy-map.service';
@Module({imports:[LicensesModule],providers:[SupabaseService,EnergyMapService,PlatformEnergyMapService],controllers:[EnergyMapController,PlatformEnergyMapController]})
export class EnergyMapModule {}
