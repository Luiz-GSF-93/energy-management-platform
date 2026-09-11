import { Injectable } from '@nestjs/common';
import { IRepository } from '../../../common/interfaces/repository.interface';

export interface Contract {
  id: string;
  contractNumber: string;
  customerId: string;
  contractTitle: string;
  monthlyFee: number;
  commissionPercentage: number;
  startDate: Date;
  endDate?: Date;
  status: string;
  contractType: string;
  createdAt: Date;
  updatedAt: Date;
}

@Injectable()
export class ContractRepository implements IRepository<Contract> {
  private contracts: Map<string, Contract> = new Map();
  private idCounter = 1;

  async create(entity: Partial<Contract>): Promise<Contract> {
    const id = String(this.idCounter++);
    const contract: Contract = {
      id,
      contractNumber: entity.contractNumber || '',
      customerId: entity.customerId || '',
      contractTitle: entity.contractTitle || '',
      monthlyFee: entity.monthlyFee || 0,
      commissionPercentage: entity.commissionPercentage || 0,
      startDate: entity.startDate || new Date(),
      endDate: entity.endDate,
      status: entity.status || 'ACTIVE',
      contractType: entity.contractType || 'ENERGY_MANAGEMENT',
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    this.contracts.set(id, contract);
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
    if (!contract) throw new Error('Contract not found');
    const updated = { ...contract, ...entity, updatedAt: new Date() };
    this.contracts.set(id, updated);
    return updated;
  }

  async delete(id: string): Promise<boolean> {
    return this.contracts.delete(id);
  }
}
