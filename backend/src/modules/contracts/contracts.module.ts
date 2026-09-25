import {ContractConfigurationsService} from './services/configurations.service';
import {ContractConfigurationsController} from './controllers/configurations.controller';
import { Module } from '@nestjs/common';
import { ContractsService } from './services/contracts.service';
import { ContractsController } from './controllers/contracts.controller';
import { SupabaseService } from '../../services/supabase.service';
import { LicensesModule } from '../licenses/licenses.module';

@Module({
  imports: [LicensesModule],
  controllers: [ContractsController,ContractConfigurationsController],
  providers: [ContractsService,ContractConfigurationsService, SupabaseService],
  exports: [ContractsService],
})
export class ContractsModule {}
