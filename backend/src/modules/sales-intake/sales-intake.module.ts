import {Module} from '@nestjs/common';
import {SupabaseService} from '../../services/supabase.service';
import {AdminSalesController,PublicSalesController} from './sales-intake.controller';
import {SalesIntakeService} from './sales-intake.service';
import {SalesAdvisorService} from './sales-advisor.service';
import {SalesCommercialService} from './sales-commercial.service';
import {SalesCommercialController} from './sales-commercial.controller';
@Module({controllers:[AdminSalesController,PublicSalesController,SalesCommercialController],providers:[SupabaseService,SalesIntakeService,SalesAdvisorService,SalesCommercialService]})
export class SalesIntakeModule{}
