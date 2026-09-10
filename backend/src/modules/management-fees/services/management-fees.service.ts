import { Injectable } from '@nestjs/common';
import { SupabaseService } from '../../../services/supabase.service';
import {
  ManagementContract,
  FeeCalculation,
  FeeComparison,
  HonoraryPayout,
} from '../interfaces/management-fees.interface';
import {
  CreateManagementContractDto,
  CalculateFeeDto,
  CompareFeeDto,
  ApproveFeeDto,
  CreateHonoraryPayoutDto,
  GetFeesDto,
  UpdateManagementContractDto,
} from '../dtos/management-fees.dto';

@Injectable()
export class ManagementFeesService {
  constructor(private supabaseService: SupabaseService) {}

  /**
   * Criar contrato de gestão
   */
  async createManagementContract(
    dto: CreateManagementContractDto,
    userId: string
  ): Promise<ManagementContract> {
    try {
      const client = this.supabaseService.getClient();

      const { data, error } = await client
        .from('management_contracts')
        .insert([
          {
            organization_id: dto.organizationId,
            consumer_unit_id: dto.consumerUnitId,
            energy_contract_id: dto.energyContractId,
            contract_type: dto.contractType,
            status: 'active',
            monthly_fee_fixed: dto.monthlyFeeFixed || null,
            setup_fee: dto.setupFee || null,
            percentage_of_savings: dto.percentageOfSavings || null,
            percentage_of_gross_savings: dto.percentageOfGrossSavings || null,
            base_fee: dto.baseFee || null,
            incentive_percentage: dto.incentivePercentage || null,
            target_savings: dto.targetSavings || null,
            start_date: new Date(dto.startDate).toISOString(),
            end_date: dto.endDate ? new Date(dto.endDate).toISOString() : null,
            created_by: userId,
          },
        ])
        .select()
        .single();

      if (error) throw error;
      console.log('✅ Contrato de gestão criado:', data.id);
      return this.mapManagementContract(data);
    } catch (exception) {
      console.error('❌ Erro ao criar contrato:', exception);
      throw exception;
    }
  }

  /**
   * Calcular honorário baseado no contrato
   */
  async calculateFee(dto: CalculateFeeDto, userId: string): Promise<FeeCalculation> {
    try {
      const client = this.supabaseService.getClient();

      // Buscar contrato de gestão
      const { data: contract, error: contractError } = await client
        .from('management_contracts')
        .select('*')
        .eq('id', dto.managementContractId)
        .single();

      if (contractError) throw contractError;
      if (!contract) throw new Error('Contrato não encontrado');

      // Calcular honorário conforme tipo de contrato
      let fixedFee = 0;
      let performanceFee = 0;
      let percentageFee = 0;
      let incentiveFee = 0;

      if (contract.contract_type === 'fixed' || contract.contract_type === 'hybrid') {
        fixedFee = contract.monthly_fee_fixed || 0;
      }

      if (contract.contract_type === 'percentage' || contract.contract_type === 'hybrid') {
        const baseAmount = contract.percentage_of_gross_savings
          ? dto.grossSavings
          : dto.netSavings;
        percentageFee = baseAmount * ((contract.percentage_of_savings || 0) / 100);
      }

      if (contract.contract_type === 'hybrid' && contract.incentive_percentage) {
        if (dto.grossSavings >= (contract.target_savings || 0)) {
          incentiveFee = dto.grossSavings * (contract.incentive_percentage / 100);
        }
      }

      const totalFee = fixedFee + percentageFee + performanceFee + incentiveFee;
      const feePercentageOfSavings = (totalFee / dto.grossSavings) * 100;

      const { data, error } = await client
        .from('fee_calculations')
        .insert([
          {
            management_contract_id: dto.managementContractId,
            settlement_id: dto.settlementId,
            reference_month: new Date(dto.referenceMonth).toISOString(),
            gross_savings: dto.grossSavings,
            net_savings: dto.netSavings,
            original_cost: dto.originalCost,
            final_cost: dto.finalCost,
            fixed_fee: fixedFee || null,
            performance_fee: performanceFee || null,
            percentage_fee: percentageFee || null,
            incentive_fee: incentiveFee || null,
            total_fee: totalFee,
            fee_percentage_of_savings: feePercentageOfSavings,
            status: 'pending',
            notes: dto.notes || null,
            created_by: userId,
          },
        ])
        .select()
        .single();

      if (error) throw error;
      console.log('✅ Honorário calculado:', data.id, 'Total:', totalFee);
      return this.mapFeeCalculation(data);
    } catch (exception) {
      console.error('❌ Erro ao calcular honorário:', exception);
      throw exception;
    }
  }

  /**
   * Comparar cenários de remuneração
   */
  async compareFeeScenarios(dto: CompareFeeDto): Promise<FeeComparison> {
    try {
      const grossSavings = dto.grossSavings;

      // Cenário 1: Remuneração Fixa
      const fixedFeeScenario = {
        monthlyFee: dto.fixedFeeOption || 500,
        setupFee: 0,
        total: (dto.fixedFeeOption || 500),
      };

      // Cenário 2: Remuneração por Percentual
      const percentagePercentage = dto.percentageOption || 15;
      const percentageFeeScenario = {
        percentage: percentagePercentage,
        baseAmount: grossSavings,
        calculatedFee: (grossSavings * percentagePercentage) / 100,
      };

      // Cenário 3: Remuneração Híbrida
      const hybridFixed = dto.hybridFixedComponent || 300;
      const hybridVariable = dto.hybridVariableComponent || 10;
      const hybridFeeScenario = {
        fixedComponent: hybridFixed,
        variableComponent: (grossSavings * hybridVariable) / 100,
        total: hybridFixed + (grossSavings * hybridVariable) / 100,
        percentageOfSavings: ((hybridFixed + (grossSavings * hybridVariable) / 100) / grossSavings) * 100,
      };

      // Recomendação
      let recommendation = 'Cenário híbrido oferece melhor relação custo-benefício';
      if (hybridFeeScenario.total > percentageFeeScenario.calculatedFee) {
        recommendation = 'Remuneração por percentual é mais competitiva';
      }

      const comparison: FeeComparison = {
        settlementId: dto.settlementId,
        referenceMonth: new Date(dto.referenceMonth),
        grossSavings,
        fixedFeeScenario,
        percentageFeeScenario,
        hybridFeeScenario,
        recommendation,
      };

      console.log('✅ Comparação de cenários realizada');
      return comparison;
    } catch (exception) {
      console.error('❌ Erro ao comparar cenários:', exception);
      throw exception;
    }
  }

  /**
   * Aprovar cálculo de honorário
   */
  async approveFee(dto: ApproveFeeDto, userId: string): Promise<FeeCalculation | null> {
    try {
      const client = this.supabaseService.getClient();

      const { data, error } = await client
        .from('fee_calculations')
        .update({
          status: 'approved',
          approved_by: userId,
          approved_at: new Date().toISOString(),
          notes: dto.notes || null,
        })
        .eq('id', dto.feeCalculationId)
        .select()
        .single();

      if (error) throw error;
      console.log('✅ Honorário aprovado:', dto.feeCalculationId);
      return this.mapFeeCalculation(data);
    } catch (exception) {
      console.error('❌ Erro ao aprovar honorário:', exception);
      return null;
    }
  }

  /**
   * Listar honorários com filtros
   */
  async listFees(organizationId: string, filters: GetFeesDto): Promise<FeeCalculation[]> {
    try {
      const client = this.supabaseService.getClient();

      let query = client
        .from('fee_calculations')
        .select('*')
        .eq('organization_id', organizationId);

      if (filters.managementContractId) {
        query = query.eq('management_contract_id', filters.managementContractId);
      }

      if (filters.settlementId) {
        query = query.eq('settlement_id', filters.settlementId);
      }

      if (filters.status) {
        query = query.eq('status', filters.status);
      }

      if (filters.startDate) {
        query = query.gte('reference_month', filters.startDate);
      }

      if (filters.endDate) {
        query = query.lte('reference_month', filters.endDate);
      }

      const limit = filters.limit ? parseInt(filters.limit, 10) : 50;
      const { data, error } = await query.order('reference_month', { ascending: false }).limit(limit);

      if (error) throw error;
      return ((data || []) as any[]).map(fee => this.mapFeeCalculation(fee));
    } catch (exception) {
      console.error('❌ Erro ao listar honorários:', exception);
      return [];
    }
  }

  /**
   * Mapear dados do Supabase para ManagementContract
   */
  private mapManagementContract(data: any): ManagementContract {
    return {
      id: data.id,
      organizationId: data.organization_id,
      consumerUnitId: data.consumer_unit_id,
      energyContractId: data.energy_contract_id,
      contractType: data.contract_type,
      status: data.status,
      monthlyFeeFixed: data.monthly_fee_fixed,
      setupFee: data.setup_fee,
      percentageOfSavings: data.percentage_of_savings,
      percentageOfGrossSavings: data.percentage_of_gross_savings,
      baseFee: data.base_fee,
      incentivePercentage: data.incentive_percentage,
      targetSavings: data.target_savings,
      startDate: new Date(data.start_date),
      endDate: data.end_date ? new Date(data.end_date) : undefined,
      createdAt: new Date(data.created_at),
      updatedAt: new Date(data.updated_at),
      createdBy: data.created_by,
    };
  }

  /**
   * Mapear dados do Supabase para FeeCalculation
   */
  private mapFeeCalculation(data: any): FeeCalculation {
    return {
      id: data.id,
      managementContractId: data.management_contract_id,
      settlementId: data.settlement_id,
      referenceMonth: new Date(data.reference_month),
      grossSavings: data.gross_savings,
      netSavings: data.net_savings,
      originalCost: data.original_cost,
      finalCost: data.final_cost,
      fixedFee: data.fixed_fee,
      performanceFee: data.performance_fee,
      percentageFee: data.percentage_fee,
      incentiveFee: data.incentive_fee,
      totalFee: data.total_fee,
      feePercentageOfSavings: data.fee_percentage_of_savings,
      status: data.status,
      approvedBy: data.approved_by,
      approvedAt: data.approved_at ? new Date(data.approved_at) : undefined,
      paidAt: data.paid_at ? new Date(data.paid_at) : undefined,
      notes: data.notes,
      createdAt: new Date(data.created_at),
      updatedAt: new Date(data.updated_at),
    };
  }
}
