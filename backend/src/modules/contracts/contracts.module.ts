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
  imports: [LicensesModule],
  controllers: [MonthlyInputsController,CalculationPreparationController,CalculationParametersController,ContractsController,ContractConfigurationsController],
  providers: [MonthlyInputsService,CalculationPreparationService,CalculationParametersService,ContractsService,ContractConfigurationsService, SupabaseService],
  exports: [ContractsService],
})
export class ContractsModule {}
