import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Approval } from './entities/approval.entity';
import { Fee } from '../management-fees/entities/fee.entity';
import { ApprovalsController } from './controllers/approvals.controller';
import { ApprovalsService } from './services/approvals.service';
import { ManagementFeesModule } from '../management-fees/management-fees.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Approval, Fee]),
    ManagementFeesModule,
  ],
  controllers: [ApprovalsController],
  providers: [ApprovalsService],
  exports: [ApprovalsService],
})
export class ApprovalsModule {}
