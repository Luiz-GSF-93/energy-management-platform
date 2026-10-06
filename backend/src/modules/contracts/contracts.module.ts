import {FinancialSettlementsController} from './controllers/financial-settlements.controller';
import {ClientPortalController} from './controllers/client-portal.controller';
import {FinancialSettlementsService} from './services/financial-settlements.service';
import {TariffLibraryService} from './services/tariff-library.service';
import {TariffLibraryController} from './controllers/tariff-library.controller';
import {SpotReconciliationController} from './controllers/spot-reconciliation.controller';
import {SpotReconciliationService} from './services/spot-reconciliation.service';
import {ReviewSnapshotsController} from './controllers/review-snapshots.controller';
import {ReviewSnapshotsService} from './services/review-snapshots.service';
import {SupplierBillingController} from './controllers/supplier-billing.controller';
import {SupplierBillingService} from './services/supplier-billing.service';
import {ManagementAllocationController} from './controllers/management-allocation.controller';
import {ManagementAllocationService} from './services/management-allocation.service';
import {EntryDraftController} from './controllers/entry-drafts.controller';
import {EntryDraftService} from './services/entry-drafts.service';
import {ConsumerUnitsModule} from '../consumer-units/consumer-units.module';
import {MonthlyCostsController} from './controllers/monthly-costs.controller';
import {MonthlyCostsService} from './services/monthly-costs.service';
import {MonthlyInputsController} from './controllers/monthly-inputs.controller';
import {MonthlyInputsService} from './services/monthly-inputs.service';
import {CalculationPreparationController} from './controllers/preparation.controller';
import {CalculationPreparationService} from './services/preparation.service';
import {CalculationParametersService} from './services/parameters.service';
import {CalculationParametersController} from './controllers/parameters.controller';
import {ContractConfigurationsService} from './services/configurations.service';
import {ContractConfigurationsController} from './controllers/configurations.controller';
import {FeeAdjustmentsController} from './controllers/fee-adjustments.controller';
import {FeeAdjustmentsService} from './services/fee-adjustments.service';
import { Module } from '@nestjs/common';
import { ContractsService } from './services/contracts.service';
import { ContractsController } from './controllers/contracts.controller';
import { SupabaseService } from '../../services/supabase.service';
import { LicensesModule } from '../licenses/licenses.module';

@Module({
  imports: [LicensesModule,ConsumerUnitsModule],
  controllers: [ClientPortalController,FinancialSettlementsController,TariffLibraryController,SpotReconciliationController,FeeAdjustmentsController,ReviewSnapshotsController,SupplierBillingController,ManagementAllocationController,EntryDraftController,MonthlyCostsController,MonthlyInputsController,CalculationPreparationController,CalculationParametersController,ContractsController,ContractConfigurationsController],
  providers: [FinancialSettlementsService,TariffLibraryService,SpotReconciliationService,FeeAdjustmentsService,ReviewSnapshotsService,SupplierBillingService,ManagementAllocationService,EntryDraftService,MonthlyCostsService,MonthlyInputsService,CalculationPreparationService,CalculationParametersService,ContractsService,ContractConfigurationsService, SupabaseService],
  exports: [ContractsService,FinancialSettlementsService],
})
export class ContractsModule {}
