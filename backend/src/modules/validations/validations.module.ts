import { Module } from '@nestjs/common';
import { SharedModule } from '../shared/shared.module';
import { CalculationValidatorService } from './services/calculation-validator.service';
import { ValidationsController } from './controllers/validations.controller';

@Module({
  imports: [SharedModule],
  controllers: [ValidationsController],
  providers: [CalculationValidatorService],
  exports: [CalculationValidatorService],
})
export class ValidationsModule {}
