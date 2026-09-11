import { Injectable } from '@nestjs/common';
import { IRepository } from '../../../common/interfaces/repository.interface';

export interface Contract {
  id: string;
  // Informações Gerais
  contractNumber: string;
  contractTitle: string;
  startDate: Date;
  endDate?: Date;
  observations?: string;
  status: string;
  contractType: string;

  // Partes do Contrato
  customerId?: string;
  supplierName: string;
  supplierCnpj?: string;
  distributorName?: string;
  distributorCnpj?: string;
  supplierContact?: string;
  supplierEmail?: string;
  supplierPhone?: string;

  // Energia e Volume
  contractedMwhAnnual: number;
  seasonality: number;
  flexibility?: number;
  demandKw: number;
  consumerUnits?: string;

  // Precificação
  pricePerMwh: number;
  regulatedPrice: number;
  tusdComponent?: number;
  icmsPercentage?: number;
  monthlyFee: number;

  // Reajustes
  adjustmentIndex?: string;
  adjustmentDate?: Date;
  adjustmentPercentage?: number;
  adjustmentCap?: number;
  adjustmentFloor?: number;

  // Flexibilidade
  variationAllowed?: number;
  takeOrPayEnabled?: boolean;
  penaltyPercentage?: number;
  noticeTermDays?: number;

  // Condições Comerciais
  billingFrequency: string;
  paymentMethod?: string;
  dueCardancyDays?: number;
  currency?: string;
  purchaseModality: string;
  commissionPercentage: number;

  createdAt: Date;
  updatedAt: Date;
}

@Injectable()
export class ContractRepository implements IRepository<Contract> {
  private contracts: Map<string, Contract> = new Map();
  private idCounter = 1;

  async create(entity: Partial<Contract>): Promise<Contract> {
    const id = `contract-${this.idCounter++}`;
    const contract: Contract = {
      id,
      contractNumber: entity.contractNumber || '',
      contractTitle: entity.contractTitle || '',
      startDate: entity.startDate instanceof Date ? entity.startDate : new Date(entity.startDate || new Date()),
      endDate: entity.endDate instanceof Date ? entity.endDate : (entity.endDate ? new Date(entity.endDate) : undefined),
      observations: entity.observations,
      status: entity.status || 'ACTIVE',
      contractType: entity.contractType || 'STANDARD',
      customerId: entity.customerId,
      supplierName: entity.supplierName || '',
      supplierCnpj: entity.supplierCnpj,
      distributorName: entity.distributorName,
      distributorCnpj: entity.distributorCnpj,
      supplierContact: entity.supplierContact,
      supplierEmail: entity.supplierEmail,
      supplierPhone: entity.supplierPhone,
      contractedMwhAnnual: entity.contractedMwhAnnual || 0,
      seasonality: entity.seasonality || 0,
      flexibility: entity.flexibility,
      demandKw: entity.demandKw || 0,
      consumerUnits: entity.consumerUnits,
      pricePerMwh: entity.pricePerMwh || 0,
      regulatedPrice: entity.regulatedPrice || 0,
      tusdComponent: entity.tusdComponent,
      icmsPercentage: entity.icmsPercentage,
      monthlyFee: entity.monthlyFee || 0,
      adjustmentIndex: entity.adjustmentIndex,
      adjustmentDate: entity.adjustmentDate instanceof Date ? entity.adjustmentDate : (entity.adjustmentDate ? new Date(entity.adjustmentDate) : undefined),
      adjustmentPercentage: entity.adjustmentPercentage,
      adjustmentCap: entity.adjustmentCap,
      adjustmentFloor: entity.adjustmentFloor,
      variationAllowed: entity.variationAllowed,
      takeOrPayEnabled: entity.takeOrPayEnabled,
      penaltyPercentage: entity.penaltyPercentage,
      noticeTermDays: entity.noticeTermDays,
      billingFrequency: entity.billingFrequency || 'MONTHLY',
      paymentMethod: entity.paymentMethod,
      dueCardancyDays: entity.dueCardancyDays,
      currency: entity.currency || 'BRL',
      purchaseModality: entity.purchaseModality || 'FREE_MARKET',
      commissionPercentage: entity.commissionPercentage || 0,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    this.contracts.set(id, contract);
    console.log(`✅ Contrato criado: ${contract.contractNumber} (ID: ${id})`);
    return contract;
  }

  async findAll(): Promise<Contract[]> {
    return Array.from(this.contracts.values());
  }

  async findById(id: string): Promise<Contract | null> {
    return this.contracts.get(id) || null;
  }

  async update(id: string, entity: Partial<Contract>): Promise<Contract> {
    const contract = this.contracts.get(id);
    if (!contract) throw new Error('Contrato não encontrado');
    const updated = { 
      ...contract, 
      ...entity, 
      updatedAt: new Date() 
    };
    this.contracts.set(id, updated);
    console.log(`✅ Contrato atualizado: ${updated.contractNumber} (ID: ${id})`);
    return updated;
  }

  async delete(id: string): Promise<boolean> {
    const contract = this.contracts.get(id);
    if (contract) {
      console.log(`✅ Contrato deletado: ${contract.contractNumber} (ID: ${id})`);
    }
    return this.contracts.delete(id);
  }

  async findByStatus(status: string): Promise<Contract[]> {
    return Array.from(this.contracts.values()).filter(c => c.status === status);
  }

  async findBySupplier(supplierName: string): Promise<Contract[]> {
    return Array.from(this.contracts.values()).filter(c => c.supplierName === supplierName);
  }
}
