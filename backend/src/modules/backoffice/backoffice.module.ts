import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Contract } from '../contracts/entities/contract.entity';
import { Fee } from '../management-fees/entities/fee.entity';
import { Approval } from '../approvals/entities/approval.entity';
import { BackofficeController } from './controllers/backoffice.controller';
import { BackofficeService } from './services/backoffice.service';

@Module({
  imports: [TypeOrmModule.forFeature([Contract, Fee, Approval])],
  controllers: [BackofficeController],
  providers: [BackofficeService],
  exports: [BackofficeService],
})
export class BackofficeModule {}
