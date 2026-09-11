import { Injectable, Logger } from '@nestjs/common';
import { ContractRepository, Contract } from '../repositories/contract.repository';

@Injectable()
export class ContractsService {
  private readonly logger = new Logger('ContractsService');

  constructor(private readonly contractRepository: ContractRepository) {}

  async create(dto: Partial<Contract>): Promise<Contract> {
    this.logger.log('Creating new contract: ' + dto.contractNumber);
    return this.contractRepository.create(dto);
  }

  async findAll(): Promise<Contract[]> {
    return this.contractRepository.findAll();
  }

  async findById(id: string): Promise<Contract> {
    const contract = await this.contractRepository.findById(id);
    if (!contract) throw new Error('Contract not found');
    return contract;
  }

  async update(id: string, dto: Partial<Contract>): Promise<Contract> {
    return this.contractRepository.update(id, dto);
  }

  async delete(id: string): Promise<boolean> {
    return this.contractRepository.delete(id);
  }

  async findByStatus(status: string): Promise<Contract[]> {
    const all = await this.contractRepository.findAll();
    return all.filter(c => c.status === status);
  }

  async getAnalytics() {
    const all = await this.contractRepository.findAll();
    return {
      total: all.length,
      active: all.filter(c => c.status === 'ACTIVE').length,
      inactive: all.filter(c => c.status === 'INACTIVE').length,
      suspended: all.filter(c => c.status === 'SUSPENDED').length,
      totalValue: all.reduce((sum, c) => sum + c.monthlyFee, 0),
    };
  }
}
