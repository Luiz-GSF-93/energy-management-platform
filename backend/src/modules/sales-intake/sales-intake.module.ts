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
import {SalesFinanceController} from './sales-finance.controller';
import {SalesFinanceService} from './sales-finance.service';
import {SalesCreationController} from './sales-creation.controller';
import {SalesCreationService} from './sales-creation.service';
import {SalesCreationAdapter} from './sales-creation.adapter';
@Module({controllers:[AdminSalesController,PublicSalesController,SalesCommercialController,SalesContractDraftsController,SalesAsaasController,SalesAsaasWebhookController,SalesFinanceController,SalesCreationController],providers:[SupabaseService,SalesIntakeService,SalesAdvisorService,SalesCommercialService,SalesContractDraftsService,SalesAsaasService,SalesAsaasAdapter,SalesFinanceService,SalesCreationService,SalesCreationAdapter]})
export class SalesIntakeModule{}
