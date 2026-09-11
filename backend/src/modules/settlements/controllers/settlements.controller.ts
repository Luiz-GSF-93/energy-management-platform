import { Controller, Post, Body, UseGuards } from '@nestjs/common';
import { SettlementEngine } from '../../engines/settlement.engine';
import { CalculateSettlementDto } from '../dtos/calculate-settlement.dto';
import { JwtAuthGuard } from '../../auth/guards/jwt.guard';

@Controller('settlements')
export class SettlementController {
  constructor(private readonly engine: SettlementEngine) {}

  @Post('calculate')
  @UseGuards(JwtAuthGuard)
  async calculate(@Body() dto: CalculateSettlementDto) {
    const referenceMonth = new Date(dto.referenceMonth);

    const result = this.engine.calculateSettlement({
      consumerUnitId: dto.consumerUnitId,
      referenceMonth,
      consumptionMwh: dto.consumptionMwh,
      regulatedEnergyPrice: dto.regulatedEnergyPrice,
      regulatedTusdCost: dto.regulatedTusdCost,
      regulatedTaxes: dto.regulatedTaxes,
      contractedPrice: dto.contractedPrice,
      cceeCost: dto.cceeCost,
      chargesCost: dto.chargesCost,
      taxesCost: dto.taxesCost,
      remunerationModel: dto.remunerationModel,
      fixedFee: dto.fixedFee,
      variablePercentage: dto.variablePercentage,
      minConsumption: dto.minConsumption,
      maxConsumption: dto.maxConsumption,
    });

    return {
      statusCode: 200,
      message: 'Apuração calculada com sucesso',
      data: result,
    };
  }
}
