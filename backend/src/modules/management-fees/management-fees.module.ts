import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Fee } from './entities/fee.entity';
import { Contract } from '../contracts/entities/contract.entity';
import { ManagementFeesController } from './controllers/management-fees.controller';
import { ManagementFeesService } from './services/management-fees.service';
import { FeeCalculationService } from './services/fee-calculation.service';
import { ContractsModule } from '../contracts/contracts.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Fee, Contract]),
    ContractsModule,
  ],
  controllers: [ManagementFeesController],
  providers: [ManagementFeesService, FeeCalculationService],
  exports: [ManagementFeesService, FeeCalculationService],
})
export class ManagementFeesModule {}
