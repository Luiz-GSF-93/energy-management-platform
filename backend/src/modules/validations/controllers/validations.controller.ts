import { Controller, Post, Get, Body, Param, UseGuards, BadRequestException } from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { CalculationValidatorService } from '../services/calculation-validator.service';
import { ValidateCalculationDto } from '../dto';
import { SupabaseService } from '../../../services/supabase.service';

interface JwtPayload {
  sub: string;
  email: string;
  iat?: number;
  exp?: number;
}

@Controller('validations')
@UseGuards(JwtAuthGuard)
export class ValidationsController {
  constructor(
    private validatorService: CalculationValidatorService,
    private supabaseService: SupabaseService,
  ) {}

  /**
   * POST /api/v1/validations/calculate
   */
  @Post('calculate')
  async validateCalculation(
    @Body() dto: ValidateCalculationDto,
    @CurrentUser() user: JwtPayload
  ) {
    try {
      const userId = user?.sub;
      const userEmail = user?.email;
      console.log('✅ userId (sub):', userId);
      console.log('✅ email:', userEmail);

      if (!userId) {
        throw new BadRequestException('Usuário não autenticado');
      }

      // Tentar buscar por email (mais confiável que auth_user_id)
      console.log('🔎 Buscando usuário por email:', userEmail);
      const { data: userData, error: userError } = await this.supabaseService
        .getClient()
        .from('users')
        .select('auth_user_id, organization_id, email')
        .eq('email', userEmail)
        .maybeSingle();

      if (userError) {
        console.error('❌ Erro na busca por email:', userError);
        throw new BadRequestException('Erro ao buscar usuário: ' + userError.message);
      }

      if (!userData) {
        console.error('❌ Usuário não encontrado com email:', userEmail);
        throw new BadRequestException('Usuário não encontrado no banco de dados');
      }

      const userOrganizationId = userData.organization_id;
      console.log('✅ Usuário encontrado. Email:', userData.email, ' Org:', userOrganizationId);

      if (userOrganizationId !== dto.organizationId) {
        throw new BadRequestException('Usuário não tem permissão para esta organização');
      }

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
   */
  @Get(':settlementId')
  async getValidations(
    @Param('settlementId') settlementId: string,
    @CurrentUser() user: JwtPayload
  ) {
    try {
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
   */
  @Post('savings')
  async calculateSavings(
    @Body() dto: { previousBill: number; currentBill: number },
    @CurrentUser() user: JwtPayload,
  ) {
    try {
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
