import {Module} from '@nestjs/common';
import {SupabaseService} from '../../services/supabase.service';
import {AdminSalesController,PublicSalesController} from './sales-intake.controller';
import {SalesIntakeService} from './sales-intake.service';
import {SalesAdvisorService} from './sales-advisor.service';
import {SalesCommercialService} from './sales-commercial.service';
import {SalesCommercialController} from './sales-commercial.controller';
import {SalesContractDraftsService} from './sales-contract-drafts.service';
import {SalesContractDraftsController} from './sales-contract-drafts.controller';
import {SalesAsaasController,SalesAsaasWebhookController} from './sales-asaas.controller';
import {SalesAsaasService} from './sales-asaas.service';
import {SalesAsaasAdapter} from './sales-asaas.adapter';
@Module({controllers:[AdminSalesController,PublicSalesController,SalesCommercialController,SalesContractDraftsController,SalesAsaasController,SalesAsaasWebhookController],providers:[SupabaseService,SalesIntakeService,SalesAdvisorService,SalesCommercialService,SalesContractDraftsService,SalesAsaasService,SalesAsaasAdapter]})
export class SalesIntakeModule{}
