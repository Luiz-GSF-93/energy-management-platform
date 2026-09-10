import { Module } from '@nestjs/common';
import { CalculationValidatorService } from './services/calculation-validator.service';
import { ValidationsController } from './controllers/validations.controller';

@Module({
  controllers: [ValidationsController],
  providers: [CalculationValidatorService],
  exports: [CalculationValidatorService],
})
export class ValidationsModule {}
