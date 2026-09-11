import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Contract } from '../entities/contract.entity';
import { CreateContractDto, UpdateContractDto } from '../dto/create-contract.dto';

@Injectable()
export class ContractsService {
  constructor(
    @InjectRepository(Contract)
    private contractRepository: Repository<Contract>,
  ) {}

  async create(createContractDto: CreateContractDto): Promise<Contract> {
    const contract = this.contractRepository.create(createContractDto);
    return this.contractRepository.save(contract);
  }

  async findAll(): Promise<Contract[]> {
    return this.contractRepository.find({
      order: { createdAt: 'DESC' },
    });
  }

  async findOne(id: string): Promise<Contract> {
    const contract = await this.contractRepository.findOne({
      where: { id },
    });

    if (!contract) {
      throw new NotFoundException('Contrato não encontrado');
    }

    return contract;
  }

  async update(
    id: string,
    updateContractDto: UpdateContractDto,
  ): Promise<Contract> {
    const contract = await this.findOne(id);
    Object.assign(contract, updateContractDto);
    return this.contractRepository.save(contract);
  }

  async remove(id: string): Promise<void> {
    const contract = await this.findOne(id);
    await this.contractRepository.remove(contract);
  }

  async findByStatus(status: string): Promise<Contract[]> {
    return this.contractRepository.find({
      where: { status: status as 'ACTIVE' | 'INACTIVE' | 'SUSPENDED' | 'TERMINATED' },
      order: { createdAt: 'DESC' },
    });
  }

  async getContractFees(contractId: string): Promise<any> {
    const contract = await this.findOne(contractId);
    return contract;
  }

  async getContractsAnalytics(): Promise<any> {
    const contracts = await this.contractRepository.find();

    const analytics = {
      totalContracts: contracts.length,
      activeContracts: contracts.filter((c) => c.status === 'ACTIVE').length,
      inactiveContracts: contracts.filter((c) => c.status === 'INACTIVE').length,
      suspendedContracts: contracts.filter((c) => c.status === 'SUSPENDED').length,
      terminatedContracts: contracts.filter((c) => c.status === 'TERMINATED').length,
      totalMonthlyFees: contracts.reduce(
        (sum, c) => sum + Number(c.monthlyFee),
        0,
      ),
      averageMonthlyFee:
        contracts.length > 0
          ? contracts.reduce((sum, c) => sum + Number(c.monthlyFee), 0) /
            contracts.length
          : 0,
    };

    return analytics;
  }
}
