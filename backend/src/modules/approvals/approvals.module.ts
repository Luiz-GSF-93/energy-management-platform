import { Module } from '@nestjs/common';
import { ApprovalsService } from './services/approvals.service';
import { ApprovalsController } from './controllers/approvals.controller';
import { ApprovalRepository } from './repositories/approval.repository';

@Module({
  controllers: [ApprovalsController],
  providers: [ApprovalsService, ApprovalRepository],
  exports: [ApprovalsService, ApprovalRepository],
})
export class ApprovalsModule {}
