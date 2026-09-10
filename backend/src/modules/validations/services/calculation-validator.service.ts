import { Injectable } from '@nestjs/common';
import { SupabaseService } from '../../../services/supabase.service';
import { CalculationValidation, ValidationError, ValidationResult } from '../interfaces';

@Injectable()
export class CalculationValidatorService {
  constructor(private supabaseService: SupabaseService) {}

  /**
   * Valida cálculo financeiro completo
   */
  validateCalculation(data: {
    consumptionKwh: number;
    regulatedCost: number;
    aclCost: number;
    grossSavings: number;
    netSavings: number;
    honorarie: number;
    totalCost: number;
    finalValue: number;
  }): { isValid: boolean; errors: ValidationError[]; warnings: string[] } {
    const errors: ValidationError[] = [];
    const warnings: string[] = [];

    // 1️⃣ Validações obrigatórias
    if (data.consumptionKwh <= 0) {
      errors.push({
        field: 'consumptionKwh',
        code: 'INVALID_CONSUMPTION',
        message: 'Consumo deve ser maior que zero',
        value: data.consumptionKwh,
      });
    }

    if (data.regulatedCost < 0) {
      errors.push({
        field: 'regulatedCost',
        code: 'INVALID_REGULATED_COST',
        message: 'Custo regulado não pode ser negativo',
        value: data.regulatedCost,
      });
    }

    if (data.aclCost < 0) {
      errors.push({
        field: 'aclCost',
        code: 'INVALID_ACL_COST',
        message: 'Custo ACL não pode ser negativo',
        value: data.aclCost,
      });
    }

    // 2️⃣ Validação de totalCost = regulatedCost + aclCost
    const expectedTotal = data.regulatedCost + data.aclCost;
    const tolerance = expectedTotal * 0.01;
    if (Math.abs(data.totalCost - expectedTotal) > tolerance) {
      errors.push({
        field: 'totalCost',
        code: 'TOTAL_COST_MISMATCH',
        message: `Custo total inconsistente. Esperado: ${expectedTotal.toFixed(2)}, Recebido: ${data.totalCost.toFixed(2)}`,
        value: data.totalCost,
      });
    }

    // 3️⃣ Validação de grossSavings
    if (data.grossSavings < 0) {
      warnings.push(`Economia bruta negativa: ${data.grossSavings.toFixed(2)}`);
    }

    // 4️⃣ Validação de netSavings
    const deductions = data.grossSavings - data.netSavings;
    if (deductions < 0 || deductions > data.grossSavings) {
      warnings.push(`Deduções fora do intervalo esperado: ${deductions.toFixed(2)}`);
    }

    // 5️⃣ Validação de honorários
    const expectedHonorarie = data.netSavings * 0.15;
    if (Math.abs(data.honorarie - expectedHonorarie) > expectedHonorarie * 0.5) {
      warnings.push(
        `Honorários fora do intervalo esperado. Esperado: ~${expectedHonorarie.toFixed(2)}, Recebido: ${data.honorarie.toFixed(2)}`
      );
    }

    // 6️⃣ Validação do valor final
    const expectedFinal = data.netSavings - data.honorarie;
    if (Math.abs(data.finalValue - expectedFinal) > 0.01) {
      errors.push({
        field: 'finalValue',
        code: 'FINAL_VALUE_MISMATCH',
        message: `Valor final inconsistente. Esperado: ${expectedFinal.toFixed(2)}, Recebido: ${data.finalValue.toFixed(2)}`,
        value: data.finalValue,
      });
    }

    return {
      isValid: errors.length === 0,
      errors,
      warnings,
    };
  }

  /**
   * Calcula economia entre dois períodos
   */
  calculateSavings(
    previousBill: number,
    currentBill: number
  ): { savings: number; percentage: number } {
    if (previousBill <= 0) {
      return { savings: 0, percentage: 0 };
    }
    const savings = previousBill - currentBill;
    const percentage = (savings / previousBill) * 100;
    return { savings, percentage };
  }

  /**
   * Detecta anomalias em histórico de cálculos
   */
  detectAnomalies(
    calculations: Array<{ finalValue: number; month: Date }>
  ): {
    anomalyCount: number;
    anomalies: string[];
  } {
    const anomalies: string[] = [];

    if (calculations.length < 2) {
      return { anomalyCount: 0, anomalies: [] };
    }

    for (let i = 1; i < calculations.length; i++) {
      const current = calculations[i].finalValue;
      const previous = calculations[i - 1].finalValue;

      if (previous === 0) continue;

      const changePercent = Math.abs((current - previous) / previous) * 100;

      if (changePercent > 50) {
        anomalies.push(
          `Variação anormal de ${changePercent.toFixed(2)}% entre ${calculations[i - 1].month.toISOString()} e ${calculations[i].month.toISOString()}`
        );
      }
    }

    return { anomalyCount: anomalies.length, anomalies };
  }

  /**
   * Salva validação no Supabase com validação de organização
   */
  async saveValidation(
    validation: CalculationValidation & { validatedBy: string },
    userOrganizationId: string
  ): Promise<ValidationResult> {
    try {
      // ✅ VALIDAÇÃO DE SEGURANÇA: Verificar que o usuário pertence à organização
      if (validation.organizationId !== userOrganizationId) {
        return { 
          success: false, 
          error: 'Usuário não autorizado para esta organização' 
        };
      }

      const client = this.supabaseService.getClient();

      const { data, error } = await client
        .from('calculation_validations')
        .insert([
          {
            settlement_id: validation.settlementId,
            energy_contract_id: validation.energyContractId,
            organization_id: validation.organizationId,
            is_valid: validation.isValid,
            errors: validation.errors,
            warnings: validation.warnings,
            consumption_kwh: validation.consumptionKwh,
            regulated_cost: validation.regulatedCost,
            acl_cost: validation.aclCost,
            gross_savings: validation.grossSavings,
            net_savings: validation.netSavings,
            honorarie: validation.honorarie,
            total_cost: validation.totalCost,
            final_value: validation.finalValue,
            validated_by: validation.validatedBy,
            metadata: validation.metadata || {},
            validated_at: new Date().toISOString(),
          },
        ])
        .select('id')
        .single();

      if (error) {
        console.error('❌ Erro ao salvar validação:', error);
        return { success: false, error: error.message };
      }

      return { success: true, validation: { ...validation, id: data?.id } };
    } catch (exception) {
      console.error('❌ Exceção ao salvar validação:', exception);
      return { success: false, error: String(exception) };
    }
  }

  /**
   * Recupera validações de uma apuração
   */
  async getValidationsBySettlement(settlementId: string): Promise<CalculationValidation[]> {
    try {
      const client = this.supabaseService.getClient();

      const { data, error } = await client
        .from('calculation_validations')
        .select('*')
        .eq('settlement_id', settlementId)
        .order('validated_at', { ascending: false });

      if (error) {
        console.error('❌ Erro ao recuperar validações:', error);
        return [];
      }

      return (data || []).map((v: any) => ({
        id: v.id,
        settlementId: v.settlement_id,
        energyContractId: v.energy_contract_id,
        organizationId: v.organization_id,
        isValid: v.is_valid,
        errors: v.errors,
        warnings: v.warnings,
        consumptionKwh: v.consumption_kwh,
        regulatedCost: v.regulated_cost,
        aclCost: v.acl_cost,
        grossSavings: v.gross_savings,
        netSavings: v.net_savings,
        honorarie: v.honorarie,
        totalCost: v.total_cost,
        finalValue: v.final_value,
        validatedAt: new Date(v.validated_at),
        validatedBy: v.validated_by,
        metadata: v.metadata,
      }));
    } catch (exception) {
      console.error('❌ Exceção ao recuperar validações:', exception);
      return [];
    }
  }
}
