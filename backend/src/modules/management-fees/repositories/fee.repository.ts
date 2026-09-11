import { Injectable } from '@nestjs/common';
import { IRepository } from '../../../common/interfaces/repository.interface';

export interface Fee {
  id: string;
  contractId: string;
  referenceMonth: string;
  baseFee: number;
  energySavings: number;
  savingsPercentage: number;
  commission: number;
  totalFee: number;
  status: string;
  createdAt: Date;
  updatedAt: Date;
}

@Injectable()
export class FeeRepository implements IRepository<Fee> {
  private fees: Map<string, Fee> = new Map();
  private idCounter = 1;

  async create(entity: Partial<Fee>): Promise<Fee> {
    const id = String(this.idCounter++);
    const fee: Fee = {
      id,
      contractId: entity.contractId || '',
      referenceMonth: entity.referenceMonth || '',
      baseFee: entity.baseFee || 0,
      energySavings: entity.energySavings || 0,
      savingsPercentage: entity.savingsPercentage || 0,
      commission: entity.commission || 0,
      totalFee: entity.totalFee || 0,
      status: entity.status || 'PENDING',
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    this.fees.set(id, fee);
    return fee;
  }

  async findAll(): Promise<Fee[]> {
    return Array.from(this.fees.values());
  }

  async findById(id: string): Promise<Fee | null> {
    return this.fees.get(id) || null;
  }

  async update(id: string, entity: Partial<Fee>): Promise<Fee> {
    const fee = this.fees.get(id);
    if (!fee) throw new Error('Fee not found');
    const updated = { ...fee, ...entity, updatedAt: new Date() };
    this.fees.set(id, updated);
    return updated;
  }

  async delete(id: string): Promise<boolean> {
    return this.fees.delete(id);
  }
}
