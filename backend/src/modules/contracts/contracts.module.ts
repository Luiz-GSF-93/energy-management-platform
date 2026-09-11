import { Module } from '@nestjs/common';
import { ContractsService } from './services/contracts.service';
import { ContractsController } from './controllers/contracts.controller';
import { ContractRepository } from './repositories/contract.repository';

@Module({
  controllers: [ContractsController],
  providers: [ContractsService, ContractRepository],
  exports: [ContractsService, ContractRepository],
})
export class ContractsModule {}
