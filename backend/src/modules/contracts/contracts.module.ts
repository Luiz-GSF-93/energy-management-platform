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
import { Module } from '@nestjs/common';
import { ContractsService } from './services/contracts.service';
import { ContractsController } from './controllers/contracts.controller';
import { SupabaseService } from '../../services/supabase.service';
import { LicensesModule } from '../licenses/licenses.module';

@Module({
  imports: [LicensesModule,ConsumerUnitsModule],
  controllers: [ManagementAllocationController,EntryDraftController,MonthlyCostsController,MonthlyInputsController,CalculationPreparationController,CalculationParametersController,ContractsController,ContractConfigurationsController],
  providers: [ManagementAllocationService,EntryDraftService,MonthlyCostsService,MonthlyInputsService,CalculationPreparationService,CalculationParametersService,ContractsService,ContractConfigurationsService, SupabaseService],
  exports: [ContractsService],
})
export class ContractsModule {}
