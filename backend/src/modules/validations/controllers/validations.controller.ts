import { Controller, Post, Get, Body, Param, UseGuards, BadRequestException, Request } from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { CalculationValidatorService } from '../services/calculation-validator.service';
import { ValidateCalculationDto } from '../dto';
import { SupabaseService } from '../../../services/supabase.service';

@Controller('validations')
@UseGuards(JwtAuthGuard)
export class ValidationsController {
  constructor(
    private validatorService: CalculationValidatorService,
    private supabaseService: SupabaseService,
  ) {}

  /**
   * POST /api/v1/validations/calculate
   * Valida um cálculo financeiro
   */
  @Post('calculate')
  async validateCalculation(@Body() dto: ValidateCalculationDto, @CurrentUser() user: any) {
    try {
      console.log('👤 Usuário recebido:', JSON.stringify(user, null, 2));

      // 1️⃣ Extrair userId do user object
      const userId = user?.sub || user?.id || user?.user_id;
      console.log('🔍 userId extraído:', userId);

      if (!userId) {
        console.error('❌ userId vazio. User object:', user);
        throw new BadRequestException('Usuário não autenticado');
      }

      // 2️⃣ Buscar organização do usuário no Supabase
      const { data: userData, error: userError } = await this.supabaseService
        .getClient()
        .from('users')
        .select('organization_id')
        .eq('id', userId)
        .single();

      if (userError || !userData) {
        console.error('❌ Erro ao buscar usuário:', userError);
        throw new BadRequestException('Usuário não encontrado no banco de dados');
      }

      const userOrganizationId = userData.organization_id;
      console.log('✅ Organização do usuário:', userOrganizationId);

      // 3️⃣ Validar que a organização do payload corresponde à do usuário
      if (userOrganizationId !== dto.organizationId) {
        throw new BadRequestException('Usuário não tem permissão para esta organização');
      }

      // 4️⃣ Validar cálculo
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

      // 5️⃣ Salvar validação com organização confirmada e userOrganizationId
      const result = await this.validatorService.saveValidation(
        {
          settlementId: dto.settlementId,
          energyContractId: dto.energyContractId,
          organizationId: userOrganizationId,
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
          validatedBy: userId,
          metadata: dto.metadata,
        },
        userOrganizationId
      );

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
      console.error('❌ Erro na validação:', error);
      const message = error instanceof Error ? error.message : 'Erro desconhecido';
      throw new BadRequestException('Erro ao validar cálculo: ' + message);
    }
  }

  /**
   * GET /api/v1/validations/:settlementId
   * Recupera validações de uma apuração
   */
  @Get(':settlementId')
  async getValidations(@Param('settlementId') settlementId: string, @CurrentUser() user: any) {
    try {
      const userId = user?.sub || user?.id || user?.user_id;
      if (!userId) {
        throw new BadRequestException('Usuário não autenticado');
      }

      const validations = await this.validatorService.getValidationsBySettlement(settlementId);

      return {
        success: true,
        count: validations.length,
        validations,
      };
    } catch (error) {
      console.error('❌ Erro ao recuperar validações:', error);
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
    @Body() dto: { previousBill: number; currentBill: number },
    @CurrentUser() user: any,
  ) {
    try {
      const userId = user?.sub || user?.id || user?.user_id;
      if (!userId) {
        throw new BadRequestException('Usuário não autenticado');
      }

      const result = this.validatorService.calculateSavings(dto.previousBill, dto.currentBill);

      return {
        success: true,
        ...result,
      };
    } catch (error) {
      console.error('❌ Erro ao calcular economia:', error);
      const message = error instanceof Error ? error.message : 'Erro desconhecido';
      throw new BadRequestException('Erro ao calcular economia: ' + message);
    }
  }
}
