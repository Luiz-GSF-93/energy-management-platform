import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Fee } from '../entities/fee.entity';
import { Contract } from '../../contracts/entities/contract.entity';
import { CreateFeeDto, UpdateFeeDto } from '../dtos/create-fee.dto';
import { FeeCalculationService } from './fee-calculation.service';

@Injectable()
export class ManagementFeesService {
  constructor(
    @InjectRepository(Fee)
    private feeRepository: Repository<Fee>,
    @InjectRepository(Contract)
    private contractRepository: Repository<Contract>,
    private feeCalculationService: FeeCalculationService,
  ) {}

  async createFee(createFeeDto: CreateFeeDto): Promise<Fee> {
    const contract = await this.contractRepository.findOne({
      where: { id: createFeeDto.contractId },
    });

    if (!contract) {
      throw new NotFoundException('Contrato não encontrado');
    }

    const { commission, totalFee } = this.feeCalculationService.calculateFee(
      contract,
      createFeeDto.baseFee,
      createFeeDto.energySavings,
      createFeeDto.savingsPercentage,
    );

    const fee = this.feeRepository.create({
      contract,
      referenceMonth: createFeeDto.referenceMonth,
      baseFee: createFeeDto.baseFee,
      energySavings: createFeeDto.energySavings,
      savingsPercentage: createFeeDto.savingsPercentage,
      commission,
      totalFee,
      status: 'PENDING',
    });

    return this.feeRepository.save(fee);
  }

  async findAllFees(): Promise<Fee[]> {
    return this.feeRepository.find({
      relations: { contract: true },
      order: { createdAt: 'DESC' },
    });
  }

  async findFeeById(id: string): Promise<Fee> {
    const fee = await this.feeRepository.findOne({
      where: { id },
      relations: { contract: true },
    });

    if (!fee) {
      throw new NotFoundException('Fee não encontrada');
    }

    return fee;
  }

  async findFeesByContract(contractId: string): Promise<Fee[]> {
    return this.feeRepository.find({
      where: { contract: { id: contractId } },
      relations: { contract: true },
      order: { referenceMonth: 'DESC' },
    });
  }

  async findFeesByStatus(status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'PAID'): Promise<Fee[]> {
    return this.feeRepository.find({
      where: { status },
      relations: { contract: true },
      order: { createdAt: 'DESC' },
    });
  }

  async updateFeeStatus(id: string, updateFeeDto: UpdateFeeDto): Promise<Fee> {
    const fee = await this.findFeeById(id);

    if (updateFeeDto.status) {
      fee.status = updateFeeDto.status;
    }

    if (updateFeeDto.notes) {
      fee.notes = updateFeeDto.notes;
    }

    return this.feeRepository.save(fee);
  }

  async calculateTotalFeesForMonth(referenceMonth: Date): Promise<number> {
    const fees = await this.feeRepository.find({
      where: { referenceMonth },
    });

    return fees.reduce((sum, fee) => sum + Number(fee.totalFee), 0);
  }

  async calculateTotalFeesForContract(contractId: string): Promise<number> {
    const fees = await this.feeRepository.find({
      where: { contract: { id: contractId } },
    });

    return fees.reduce((sum, fee) => sum + Number(fee.totalFee), 0);
  }

  async getFeesAnalytics(): Promise<any> {
    const allFees = await this.feeRepository.find();

    const analytics = {
      totalFees: allFees.length,
      pendingCount: allFees.filter((f) => f.status === 'PENDING').length,
      approvedCount: allFees.filter((f) => f.status === 'APPROVED').length,
      rejectedCount: allFees.filter((f) => f.status === 'REJECTED').length,
      paidCount: allFees.filter((f) => f.status === 'PAID').length,
      totalAmount: allFees.reduce((sum, fee) => sum + Number(fee.totalFee), 0),
      averageFee:
        allFees.length > 0
          ? allFees.reduce((sum, fee) => sum + Number(fee.totalFee), 0) /
            allFees.length
          : 0,
    };

    return analytics;
  }
}
