import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Contract } from '../../contracts/entities/contract.entity';
import { Fee } from '../../management-fees/entities/fee.entity';
import { Approval } from '../../approvals/entities/approval.entity';

@Injectable()
export class BackofficeService {
  constructor(
    @InjectRepository(Contract)
    private contractRepository: Repository<Contract>,
    @InjectRepository(Fee)
    private feeRepository: Repository<Fee>,
    @InjectRepository(Approval)
    private approvalRepository: Repository<Approval>,
  ) {}

  async getDashboardOverview(): Promise<any> {
    const contracts = await this.contractRepository.find();
    const fees = await this.feeRepository.find();
    const approvals = await this.approvalRepository.find();

    return {
      contracts: {
        total: contracts.length,
        active: contracts.filter((c) => c.status === 'ACTIVE').length,
        inactive: contracts.filter((c) => c.status === 'INACTIVE').length,
        totalMonthlyFees: contracts.reduce(
          (sum, c) => sum + Number(c.monthlyFee),
          0,
        ),
      },
      fees: {
        total: fees.length,
        pending: fees.filter((f) => f.status === 'PENDING').length,
        approved: fees.filter((f) => f.status === 'APPROVED').length,
        rejected: fees.filter((f) => f.status === 'REJECTED').length,
        paid: fees.filter((f) => f.status === 'PAID').length,
        totalAmount: fees.reduce((sum, f) => sum + Number(f.totalFee), 0),
      },
      approvals: {
        total: approvals.length,
        pending: approvals.filter((a) => a.status === 'PENDING_REVIEW').length,
        approved: approvals.filter((a) => a.status === 'APPROVED').length,
        rejected: approvals.filter((a) => a.status === 'REJECTED').length,
      },
      timestamp: new Date(),
    };
  }

  async getRevenueReport(): Promise<any> {
    const fees = await this.feeRepository.find({
      relations: { contract: true },
    });

    const byMonth: Record<string, any> = {};
    fees.forEach((fee) => {
      const month = new Date(fee.referenceMonth).toISOString().split('T')[0];
      if (!byMonth[month]) {
        byMonth[month] = {
          month,
          baseFees: 0,
          commissions: 0,
          total: 0,
          count: 0,
        };
      }
      byMonth[month].baseFees += Number(fee.baseFee);
      byMonth[month].commissions += Number(fee.commission);
      byMonth[month].total += Number(fee.totalFee);
      byMonth[month].count += 1;
    });

    return Object.values(byMonth);
  }

  async getContractPerformance(): Promise<any> {
    const contracts = await this.contractRepository.find();
    const fees = await this.feeRepository.find({
      relations: { contract: true },
    });

    const performance = contracts.map((contract) => {
      const contractFees = fees.filter((f) => f.contract.id === contract.id);
      const totalEarned = contractFees.reduce(
        (sum, f) => sum + Number(f.totalFee),
        0,
      );
      const totalSavings = contractFees.reduce(
        (sum, f) => sum + Number(f.energySavings),
        0,
      );

      return {
        contractId: contract.id,
        contractNumber: contract.contractNumber,
        contractTitle: contract.contractTitle,
        status: contract.status,
        monthlyFee: contract.monthlyFee,
        totalEarned,
        totalSavings,
        feeCount: contractFees.length,
        averageFee:
          contractFees.length > 0
            ? totalEarned / contractFees.length
            : 0,
      };
    });

    return performance;
  }

  async getPublicationReadiness(): Promise<any> {
    const fees = await this.feeRepository.find({
      relations: { contract: true },
    });

    const approvals = await this.approvalRepository.find({
      relations: { fee: true },
    });

    const readyForPublication = fees.filter((fee) => {
      const approval = approvals.find((a) => a.fee.id === fee.id);
      return fee.status === 'APPROVED' && approval?.status === 'APPROVED';
    });

    return {
      totalReadyForPublication: readyForPublication.length,
      readyFees: readyForPublication.map((f) => ({
        id: f.id,
        referenceMonth: f.referenceMonth,
        totalFee: f.totalFee,
        contract: f.contract.contractNumber,
      })),
    };
  }
}
