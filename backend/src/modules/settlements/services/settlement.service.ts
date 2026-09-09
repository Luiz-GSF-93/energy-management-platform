import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { SupabaseService } from '../../../services/supabase.service';
import { CreateSettlementDto, UpdateSettlementDto, ApproveSettlementDto, PublishSettlementDto } from '../dto/create-settlement.dto';

@Injectable()
export class SettlementService {
  constructor(private supabaseService: SupabaseService) {}

  async createSettlement(createSettlementDto: CreateSettlementDto, userId: string) {
    const { contractId, consumerUnitId, month, consumptionKwh, regulatedCost, aclCost, deductions } = createSettlementDto;

    // Calcular economia bruta
    const grossSavings = regulatedCost - aclCost;
    const netSavings = grossSavings - (deductions || 0);

    // Buscar contrato para obter percentual de honorário
    const { data: contract, error: contractError } = await this.supabaseService
      .getClient()
      .from('energy_contracts')
      .select('honorariePercentage')
      .eq('id', contractId)
      .single();

    if (contractError) throw new NotFoundException('Contract not found');

    const honorarie = netSavings * ((contract.honorariePercentage || 0) / 100);

    // Criar settlement
    const { data, error } = await this.supabaseService
      .getClient()
      .from('monthly_energy_settlements')
      .insert([{
        contractId,
        consumerUnitId,
        month: new Date(month).toISOString().split('T')[0],
        consumptionKwh,
        regulatedCost,
        aclCost,
        grossSavings,
        deductions: deductions || 0,
        netSavings,
        honorarie,
        status: 'DRAFT',
        createdBy: userId,
      }])
      .select()
      .single();

    if (error) throw new BadRequestException(error.message);

    // Registrar versão inicial
    await this.supabaseService
      .getClient()
      .from('settlement_versions')
      .insert([{
        settlementId: data.id,
        versionNumber: 1,
        data: JSON.stringify(data),
        reason: 'Initial creation',
        createdBy: userId,
      }]);

    return data;
  }

  async getSettlementsByConsumerUnit(consumerUnitId: string) {
    const { data, error } = await this.supabaseService
      .getClient()
      .from('monthly_energy_settlements')
      .select('*')
      .eq('consumerUnitId', consumerUnitId)
      .is('deletedAt', null)
      .order('month', { ascending: false });

    if (error) throw new BadRequestException(error.message);
    return data;
  }

  async getSettlement(id: string) {
    const { data, error } = await this.supabaseService
      .getClient()
      .from('monthly_energy_settlements')
      .select('*')
      .eq('id', id)
      .is('deletedAt', null)
      .single();

    if (error || !data) throw new NotFoundException('Settlement not found');
    return data;
  }

  async approveSettlement(id: string, userId: string, approveSettlementDto: ApproveSettlementDto) {
    const settlement = await this.getSettlement(id);

    // Atualizar status
    const { data, error } = await this.supabaseService
      .getClient()
      .from('monthly_energy_settlements')
      .update({
        status: 'APPROVED',
        approvedBy: userId,
        approvedAt: new Date().toISOString(),
      })
      .eq('id', id)
      .select()
      .single();

    if (error) throw new BadRequestException(error.message);

    // Registrar versão aprovada
    const newVersion = settlement.versionNumber + 1;
    await this.supabaseService
      .getClient()
      .from('settlement_versions')
      .insert([{
        settlementId: id,
        versionNumber: newVersion,
        data: JSON.stringify(data),
        reason: approveSettlementDto.reason || 'Approved',
        createdBy: userId,
      }]);

    return data;
  }

  async publishSettlement(id: string, userId: string, publishSettlementDto: PublishSettlementDto) {
    const settlement = await this.getSettlement(id);

    if (settlement.status !== 'APPROVED') {
      throw new BadRequestException('Settlement must be approved before publishing');
    }

    // Atualizar status
    const { data, error } = await this.supabaseService
      .getClient()
      .from('monthly_energy_settlements')
      .update({
        status: 'PUBLISHED',
        publishedAt: new Date().toISOString(),
      })
      .eq('id', id)
      .select()
      .single();

    if (error) throw new BadRequestException(error.message);

    // Registrar versão publicada
    const newVersion = settlement.versionNumber + 1;
    await this.supabaseService
      .getClient()
      .from('settlement_versions')
      .insert([{
        settlementId: id,
        versionNumber: newVersion,
        data: JSON.stringify(data),
        reason: publishSettlementDto.reason || 'Published',
        createdBy: userId,
      }]);

    return data;
  }

  async getSettlementVersions(settlementId: string) {
    const { data, error } = await this.supabaseService
      .getClient()
      .from('settlement_versions')
      .select('*')
      .eq('settlementId', settlementId)
      .order('versionNumber', { ascending: false });

    if (error) throw new BadRequestException(error.message);
    return data;
  }
}
