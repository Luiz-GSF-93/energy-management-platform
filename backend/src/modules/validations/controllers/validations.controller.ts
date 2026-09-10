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
   * Valida um cálculo financeiro
   */
  @Post('calculate')
  async validateCalculation(
    @Body() dto: ValidateCalculationDto,
    @CurrentUser() user: JwtPayload
  ) {
    try {
      console.log('👤 @CurrentUser recebido:', JSON.stringify(user, null, 2));

      // 1️⃣ Extrair userId do JWT (sub)
      const userId = user?.sub;
      console.log('🔍 userId extraído:', userId);

      if (!userId) {
        console.error('❌ userId vazio!');
        throw new BadRequestException('Usuário não autenticado');
      }

      // 2️⃣ Debug: Consultar usuário no Supabase
      console.log('🔎 Buscando usuário com id:', userId);
      const { data: userData, error: userError } = await this.supabaseService
        .getClient()
        .from('users')
        .select('id, auth_user_id, email, organization_id')
        .eq('id', userId)
        .single();

      if (userError) {
        console.error('❌ Erro ao buscar usuário:', userError);
        
        // Tentar buscar por auth_user_id
        console.log('🔄 Tentando buscar por auth_user_id:', userId);
        const { data: userData2, error: userError2 } = await this.supabaseService
          .getClient()
          .from('users')
          .select('id, auth_user_id, email, organization_id')
          .eq('auth_user_id', userId)
          .single();
        
        if (userError2 || !userData2) {
          console.error('❌ Usuário não encontrado por auth_user_id:', userError2);
          throw new BadRequestException('Usuário não encontrado no banco de dados');
        }

        console.log('✅ Usuário encontrado por auth_user_id:', userData2);
        var userOrganizationId = userData2.organization_id;
      } else {
        console.log('✅ Usuário encontrado por id:', userData);
        var userOrganizationId = userData.organization_id;
      }

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

      // 5️⃣ Salvar validação
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
