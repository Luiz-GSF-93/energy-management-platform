import { Injectable, Logger } from '@nestjs/common';
import { FeeRepository, Fee } from '../repositories/fee.repository';

@Injectable()
export class ManagementFeesService {
  private readonly logger = new Logger('ManagementFeesService');

  constructor(private readonly feeRepository: FeeRepository) {}

  async create(dto: Partial<Fee>): Promise<Fee> {
    this.logger.log('Creating new fee for contract: ' + dto.contractId);
    const fee = await this.feeRepository.create(dto);
    return fee;
  }

  async findAll(): Promise<Fee[]> {
    return this.feeRepository.findAll();
  }

  async findById(id: string): Promise<Fee> {
    const fee = await this.feeRepository.findById(id);
    if (!fee) throw new Error('Fee not found');
    return fee;
  }

  async update(id: string, dto: Partial<Fee>): Promise<Fee> {
    return this.feeRepository.update(id, dto);
  }

  async delete(id: string): Promise<boolean> {
    return this.feeRepository.delete(id);
  }

  async findByStatus(status: string): Promise<Fee[]> {
    const all = await this.feeRepository.findAll();
    return all.filter(f => f.status === status);
  }

  async findByContractId(contractId: string): Promise<Fee[]> {
    const all = await this.feeRepository.findAll();
    return all.filter(f => f.contractId === contractId);
  }

  async getAnalytics() {
    const all = await this.feeRepository.findAll();
    const pending = all.filter(f => f.status === 'PENDING');
    const approved = all.filter(f => f.status === 'APPROVED');
    const rejected = all.filter(f => f.status === 'REJECTED');
    const paid = all.filter(f => f.status === 'PAID');

    return {
      total: all.length,
      pending: pending.length,
      approved: approved.length,
      rejected: rejected.length,
      paid: paid.length,
      totalValue: all.reduce((sum, f) => sum + f.totalFee, 0),
      pendingValue: pending.reduce((sum, f) => sum + f.totalFee, 0),
      approvedValue: approved.reduce((sum, f) => sum + f.totalFee, 0),
      paidValue: paid.reduce((sum, f) => sum + f.totalFee, 0),
    };
  }

  async updateStatus(id: string, status: string): Promise<Fee> {
    return this.feeRepository.update(id, { status });
  }
}
