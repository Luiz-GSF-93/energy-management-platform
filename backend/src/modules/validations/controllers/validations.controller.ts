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
      console.log('✅ userId do JWT:', userId);

      if (!userId) {
        throw new BadRequestException('Usuário não autenticado');
      }

      // Buscar usuário - tentar ambos id (text) e id (uuid)
      let userData = null;
      
      // Primeira tentativa: buscar como text
      const { data: userDataText } = await this.supabaseService
        .getClient()
        .from('users')
        .select('organization_id')
        .eq('id', userId)
        .single();

      if (userDataText) {
        userData = userDataText;
        console.log('✅ Usuário encontrado por id (text)');
      }

      // Se não encontrou, tentar como UUID
      if (!userData) {
        const { data: userDataUuid } = await this.supabaseService
          .getClient()
          .from('users')
          .select('organization_id')
          .eq('auth_user_id', userId)
          .single();

        if (userDataUuid) {
          userData = userDataUuid;
          console.log('✅ Usuário encontrado por auth_user_id');
        }
      }

      if (!userData) {
        console.error('❌ Usuário não encontrado');
        throw new BadRequestException('Usuário não encontrado no banco de dados');
      }

      const userOrganizationId = userData.organization_id;

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
