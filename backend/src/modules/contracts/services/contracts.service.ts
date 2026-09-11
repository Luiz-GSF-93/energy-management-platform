import { Injectable, Logger } from '@nestjs/common';
import { ContractRepository, Contract } from '../repositories/contract.repository';

@Injectable()
export class ContractsService {
  private readonly logger = new Logger('ContractsService');

  constructor(private readonly contractRepository: ContractRepository) {}

  async create(dto: Partial<Contract>): Promise<Contract> {
    this.logger.log('🔄 Criando novo contrato: ' + dto.contractNumber);
    return this.contractRepository.create(dto);
  }

  async findAll(): Promise<Contract[]> {
    return this.contractRepository.findAll();
  }

  async findById(id: string): Promise<Contract> {
    const contract = await this.contractRepository.findById(id);
    if (!contract) throw new Error('Contrato não encontrado');
    return contract;
  }

  async update(id: string, dto: Partial<Contract>): Promise<Contract> {
    return this.contractRepository.update(id, dto);
  }

  async delete(id: string): Promise<boolean> {
    return this.contractRepository.delete(id);
  }

  async findByStatus(status: string): Promise<Contract[]> {
    return this.contractRepository.findByStatus(status);
  }

  async getAnalytics() {
    const all = await this.contractRepository.findAll();
    const active = all.filter(c => c.status === 'ACTIVE');
    
    const totalMwh = all.reduce((sum, c) => sum + Number(c.contractedMwhAnnual || 0), 0);
    const avgPrice = active.length > 0 
      ? active.reduce((sum, c) => sum + Number(c.pricePerMwh || 0), 0) / active.length 
      : 0;
    
    const totalEconomy = active.reduce((sum, c) => {
      const regulatedCost = Number(c.contractedMwhAnnual || 0) * Number(c.regulatedPrice || 0);
      const freeMarketCost = Number(c.contractedMwhAnnual || 0) * Number(c.pricePerMwh || 0);
      return sum + (regulatedCost - freeMarketCost);
    }, 0);

    return {
      total: all.length,
      active: active.length,
      inactive: all.filter(c => c.status === 'INACTIVE').length,
      suspended: all.filter(c => c.status === 'SUSPENDED').length,
      terminated: all.filter(c => c.status === 'TERMINATED').length,
      totalValue: all.reduce((sum, c) => sum + Number(c.monthlyFee || 0), 0),
      totalMwhContracted: totalMwh,
      averagePricePerMwh: Number(avgPrice.toFixed(2)),
      totalEconomySavings: Number(totalEconomy.toFixed(2)),
    };
  }

  async calculateEconomySavings(contractId: string) {
    const contract = await this.findById(contractId);
    
    const regulatedCost = Number(contract.contractedMwhAnnual) * Number(contract.regulatedPrice);
    const freeMarketCost = Number(contract.contractedMwhAnnual) * Number(contract.pricePerMwh);
    const grossSavings = regulatedCost - freeMarketCost;
    const savingsPercentage = regulatedCost > 0 ? (grossSavings / regulatedCost) * 100 : 0;
    
    const managementFeeAnnual = Number(contract.monthlyFee) * 12;
    const netSavings = grossSavings - managementFeeAnnual;
    const roi = managementFeeAnnual > 0 ? (netSavings / managementFeeAnnual) * 100 : 0;

    return {
      contractId,
      contractNumber: contract.contractNumber,
      supplierName: contract.supplierName,
      contractedMwhAnnual: contract.contractedMwhAnnual,
      regulatedPrice: contract.regulatedPrice,
      freeMarketPrice: contract.pricePerMwh,
      regulatedCost: Number(regulatedCost.toFixed(2)),
      freeMarketCost: Number(freeMarketCost.toFixed(2)),
      grossSavings: Number(grossSavings.toFixed(2)),
      savingsPercentage: Number(savingsPercentage.toFixed(2)),
      managementFeeAnnual: Number(managementFeeAnnual.toFixed(2)),
      netSavings: Number(netSavings.toFixed(2)),
      roi: Number(roi.toFixed(2)),
      breakEvenMonths: managementFeeAnnual > 0 ? Math.ceil((managementFeeAnnual / (grossSavings / 12))) : 0,
    };
  }

  async getContractComparison() {
    const all = await this.contractRepository.findAll();
    
    return all.map(contract => {
      const regulatedCost = Number(contract.contractedMwhAnnual || 0) * Number(contract.regulatedPrice || 0);
      const freeMarketCost = Number(contract.contractedMwhAnnual || 0) * Number(contract.pricePerMwh || 0);
      const grossSavings = regulatedCost - freeMarketCost;

      return {
        contractNumber: contract.contractNumber,
        contractTitle: contract.contractTitle,
        supplierName: contract.supplierName,
        mwhAnnual: contract.contractedMwhAnnual,
        regulatedPrice: contract.regulatedPrice,
        freeMarketPrice: contract.pricePerMwh,
        regulatedCost: Number(regulatedCost.toFixed(2)),
        freeMarketCost: Number(freeMarketCost.toFixed(2)),
        grossSavings: Number(grossSavings.toFixed(2)),
        savingsPercentage: regulatedCost > 0 ? Number(((grossSavings / regulatedCost) * 100).toFixed(2)) : 0,
        status: contract.status,
        vigencyMonths: this.calculateVigency(contract.startDate, contract.endDate),
      };
    });
  }

  async getContractAlert() {
    const all = await this.contractRepository.findAll();
    const now = new Date();
    const thirtyDaysFromNow = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

    return all
      .filter(c => c.endDate && c.endDate <= thirtyDaysFromNow && c.endDate >= now)
      .map(c => ({
        contractNumber: c.contractNumber,
        contractTitle: c.contractTitle,
        expirationDate: c.endDate,
        daysUntilExpiration: Math.ceil((c.endDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)),
        status: 'EXPIRING_SOON',
        severity: 'WARNING',
      }));
  }

  private calculateVigency(startDate: Date, endDate?: Date): number {
    if (!endDate) return 0;
    const start = new Date(startDate);
    const end = new Date(endDate);
    return Math.round((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24 * 30));
  }
}
