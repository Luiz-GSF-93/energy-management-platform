import {Module} from '@nestjs/common';
import {SupabaseService} from '../../services/supabase.service';
import {AdminSalesController,PublicSalesController} from './sales-intake.controller';
import {SalesIntakeService} from './sales-intake.service';
import {SalesAdvisorService} from './sales-advisor.service';
@Module({controllers:[AdminSalesController,PublicSalesController],providers:[SupabaseService,SalesIntakeService,SalesAdvisorService]})
export class SalesIntakeModule{}
