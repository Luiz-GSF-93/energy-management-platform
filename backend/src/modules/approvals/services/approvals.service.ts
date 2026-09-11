import { Injectable, Logger } from '@nestjs/common';
import { ApprovalRepository, Approval } from '../repositories/approval.repository';

@Injectable()
export class ApprovalsService {
  private readonly logger = new Logger('ApprovalsService');

  constructor(private readonly approvalRepository: ApprovalRepository) {}

  async create(dto: Partial<Approval>): Promise<Approval> {
    this.logger.log('Creating new approval for fee: ' + dto.feeId);
    return this.approvalRepository.create(dto);
  }

  async findAll(): Promise<Approval[]> {
    return this.approvalRepository.findAll();
  }

  async findById(id: string): Promise<Approval> {
    const approval = await this.approvalRepository.findById(id);
    if (!approval) throw new Error('Approval not found');
    return approval;
  }

  async update(id: string, dto: Partial<Approval>): Promise<Approval> {
    return this.approvalRepository.update(id, dto);
  }

  async delete(id: string): Promise<boolean> {
    return this.approvalRepository.delete(id);
  }

  async findByFeeId(feeId: string): Promise<Approval[]> {
    const all = await this.approvalRepository.findAll();
    return all.filter(a => a.feeId === feeId);
  }

  async findByStatus(status: string): Promise<Approval[]> {
    const all = await this.approvalRepository.findAll();
    return all.filter(a => a.status === status);
  }

  async approve(id: string, comments?: string): Promise<Approval> {
    return this.approvalRepository.update(id, {
      status: 'APPROVED',
      comments,
      approvedAt: new Date(),
    });
  }

  async reject(id: string, comments?: string): Promise<Approval> {
    return this.approvalRepository.update(id, {
      status: 'REJECTED',
      comments,
      approvedAt: new Date(),
    });
  }

  async getAnalytics() {
    const all = await this.approvalRepository.findAll();
    const approved = all.filter(a => a.status === 'APPROVED');
    const rejected = all.filter(a => a.status === 'REJECTED');
    const pending = all.filter(a => a.status === 'PENDING_REVIEW');

    return {
      total: all.length,
      approved: approved.length,
      rejected: rejected.length,
      pending: pending.length,
      approvalRate: all.length > 0 ? ((approved.length / all.length) * 100).toFixed(2) : '0',
    };
  }
}
