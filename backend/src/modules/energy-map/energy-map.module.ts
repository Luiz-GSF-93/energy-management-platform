import {Module} from '@nestjs/common';
import {SupabaseService} from '../../services/supabase.service';
import {LicensesModule} from '../licenses/licenses.module';
import {EnergyMapService} from './energy-map.service';
import {EnergyMapController} from './energy-map.controller';
import {PlatformEnergyMapController} from './platform-energy-map.controller';
import {PlatformEnergyMapService} from './platform-energy-map.service';
import {EnergyMapGeocodingService} from './geocoding.service';
import {EnergyMapGeocodingController} from './geocoding.controller';
import {MapboxGeocodingProvider} from './geocoding.provider';
import {EnergyMapGeocodingWorker} from './geocoding.worker';
@Module({imports:[LicensesModule],providers:[SupabaseService,EnergyMapService,PlatformEnergyMapService,EnergyMapGeocodingService,MapboxGeocodingProvider,EnergyMapGeocodingWorker],controllers:[EnergyMapController,PlatformEnergyMapController,EnergyMapGeocodingController]})
export class EnergyMapModule {}
