import { Controller, Post, Get, Body, Param, UseGuards, BadRequestException } from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { CalculationValidatorService } from '../services/calculation-validator.service';
import { ValidateCalculationDto } from '../dto';

@Controller('validations')
@UseGuards(JwtAuthGuard)
export class ValidationsController {
  constructor(private validatorService: CalculationValidatorService) {}

  /**
   * POST /api/v1/validations/calculate
   * Valida um cálculo financeiro
   */
  @Post('calculate')
  async validateCalculation(@Body() dto: ValidateCalculationDto) {
    try {
      const validation = this.validatorService.validateCalculation({
        consumptionKwh: dto.consumptionKwh,
        regulatedCost: dto.regulatedCost,
        aclCost: dto.aclCost,
        grossSavings: dto.grossSavings,
        netSavings: dto.netSavings,
        honorarie: dto.honorarie,
        totalCost: dto.totalCost,
        finalValue: dto.finalValue,
      });

      if (!validation.isValid) {
        return {
          success: false,
          isValid: false,
          errors: validation.errors,
          warnings: validation.warnings,
          message: 'Validação falhou - existem erros',
        };
      }

      const result = await this.validatorService.saveValidation({
        settlementId: dto.settlementId,
        energyContractId: dto.energyContractId,
        organizationId: dto.organizationId,
        consumptionKwh: dto.consumptionKwh,
        regulatedCost: dto.regulatedCost,
        aclCost: dto.aclCost,
        grossSavings: dto.grossSavings,
        netSavings: dto.netSavings,
        honorarie: dto.honorarie,
        totalCost: dto.totalCost,
        finalValue: dto.finalValue,
        isValid: true,
        errors: [],
        warnings: validation.warnings,
        validatedAt: new Date(),
        validatedBy: dto.validatedBy || 'system',
        metadata: dto.metadata,
      });

      if (!result.success) {
        throw new BadRequestException(result.error || 'Erro ao salvar validação');
      }

      return {
        success: true,
        isValid: true,
        validationId: result.validation?.id,
        warnings: validation.warnings,
        message: 'Cálculo validado com sucesso',
      };
    } catch (error) {
      console.error('Erro na validação:', error);
      const message = error instanceof Error ? error.message : 'Erro desconhecido';
      throw new BadRequestException('Erro ao validar cálculo: ' + message);
    }
  }

  /**
   * GET /api/v1/validations/:settlementId
   * Recupera validações de uma apuração
   */
  @Get(':settlementId')
  async getValidations(@Param('settlementId') settlementId: string) {
    try {
      const validations = await this.validatorService.getValidationsBySettlement(settlementId);

      return {
        success: true,
        count: validations.length,
        validations,
      };
    } catch (error) {
      console.error('Erro ao recuperar validações:', error);
      const message = error instanceof Error ? error.message : 'Erro desconhecido';
      throw new BadRequestException('Erro ao recuperar validações: ' + message);
    }
  }

  /**
   * POST /api/v1/validations/savings
   * Calcula economia entre períodos
   */
  @Post('savings')
  async calculateSavings(
    @Body() dto: { previousBill: number; currentBill: number }
  ) {
    try {
      const result = this.validatorService.calculateSavings(dto.previousBill, dto.currentBill);

      return {
        success: true,
        ...result,
      };
    } catch (error) {
      console.error('Erro ao calcular economia:', error);
      const message = error instanceof Error ? error.message : 'Erro desconhecido';
      throw new BadRequestException('Erro ao calcular economia: ' + message);
    }
  }
}
