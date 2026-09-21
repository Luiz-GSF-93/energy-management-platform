import { Module } from '@nestjs/common';
import { CommonModule } from '../../common/common.module';
import { LicensesController } from './controllers/licenses.controller';
import { LicensesService } from './services/licenses.service';

@Module({
  imports: [CommonModule],
  controllers: [LicensesController],
  providers: [LicensesService],
  exports: [LicensesService],
})
export class LicensesModule {}
