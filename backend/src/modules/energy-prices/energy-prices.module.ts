import {Module} from '@nestjs/common';
import {LicensesModule} from '../licenses/licenses.module';
import {SupabaseService} from '../../services/supabase.service';
import {EnergyPriceService} from './energy-price.service';
import {EnergyPriceController,EnergyPricePortalController} from './energy-price.controller';
@Module({imports:[LicensesModule],controllers:[EnergyPriceController,EnergyPricePortalController],providers:[EnergyPriceService,SupabaseService]})
export class EnergyPricesModule{}
