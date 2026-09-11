import { Module } from '@nestjs/common';
import { BackofficeService } from './services/backoffice.service';
import { BackofficeController } from './controllers/backoffice.controller';
import { ContractsModule } from '../contracts/contracts.module';
import { ManagementFeesModule } from '../management-fees/management-fees.module';
import { ApprovalsModule } from '../approvals/approvals.module';

@Module({
  imports: [ContractsModule, ManagementFeesModule, ApprovalsModule],
  controllers: [BackofficeController],
  providers: [BackofficeService],
  exports: [BackofficeService],
})
export class BackofficeModule {}
