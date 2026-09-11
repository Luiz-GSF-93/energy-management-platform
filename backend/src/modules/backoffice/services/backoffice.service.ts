import { Injectable, Logger } from '@nestjs/common';
import { ContractsService } from '../../contracts/services/contracts.service';
import { ManagementFeesService } from '../../management-fees/services/management-fees.service';
import { ApprovalsService } from '../../approvals/services/approvals.service';

@Injectable()
export class BackofficeService {
  private readonly logger = new Logger('BackofficeService');

  constructor(
    private readonly contractsService: ContractsService,
    private readonly feesService: ManagementFeesService,
    private readonly approvalsService: ApprovalsService,
  ) {}

  async getDashboard() {
    const contracts = await this.contractsService.findAll();
    const fees = await this.feesService.findAll();
    const approvals = await this.approvalsService.findAll();

    return {
      contracts: {
        total: contracts.length,
        active: contracts.filter(c => c.status === 'ACTIVE').length,
        inactive: contracts.filter(c => c.status === 'INACTIVE').length,
      },
      fees: {
        total: fees.length,
        pending: fees.filter(f => f.status === 'PENDING').length,
        approved: fees.filter(f => f.status === 'APPROVED').length,
        paid: fees.filter(f => f.status === 'PAID').length,
      },
      approvals: {
        total: approvals.length,
        pending: approvals.filter(a => a.status === 'PENDING_REVIEW').length,
        approved: approvals.filter(a => a.status === 'APPROVED').length,
      },
    };
  }

  async getRevenueReport() {
    const fees = await this.feesService.findAll();
    const approved = fees.filter(f => f.status === 'APPROVED');
    const paid = fees.filter(f => f.status === 'PAID');

    return {
      totalRevenue: fees.reduce((sum, f) => sum + f.totalFee, 0),
      approvedRevenue: approved.reduce((sum, f) => sum + f.totalFee, 0),
      paidRevenue: paid.reduce((sum, f) => sum + f.totalFee, 0),
      pendingRevenue: fees
        .filter(f => f.status === 'PENDING')
        .reduce((sum, f) => sum + f.totalFee, 0),
    };
  }

  async getContractPerformance() {
    const contracts = await this.contractsService.findAll();
    const fees = await this.feesService.findAll();

    return contracts.map(contract => ({
      contractId: contract.id,
      contractNumber: contract.contractNumber,
      totalFees: fees
        .filter(f => f.contractId === contract.id)
        .reduce((sum, f) => sum + f.totalFee, 0),
      feeCount: fees.filter(f => f.contractId === contract.id).length,
    }));
  }

  async getPublicationReadiness() {
    const contracts = await this.contractsService.findAll();
    const fees = await this.feesService.findAll();
    const approvals = await this.approvalsService.findAll();

    const readyForPublication = fees.filter(
      f => f.status === 'APPROVED' && approvals.find(a => a.feeId === f.id && a.status === 'APPROVED'),
    ).length;

    return {
      readyCount: readyForPublication,
      totalCount: fees.length,
      readinessPercentage: fees.length > 0 ? ((readyForPublication / fees.length) * 100).toFixed(2) : '0',
    };
  }
}
