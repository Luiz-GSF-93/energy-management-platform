import { Module } from '@nestjs/common';
import { ManagementFeesService } from './services/management-fees.service';
import { ManagementFeesController } from './controllers/management-fees.controller';
import { FeeRepository } from './repositories/fee.repository';

@Module({
  controllers: [ManagementFeesController],
  providers: [ManagementFeesService, FeeRepository],
  exports: [ManagementFeesService, FeeRepository],
})
export class ManagementFeesModule {}
