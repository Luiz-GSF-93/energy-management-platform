import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Approval } from '../entities/approval.entity';
import { Fee } from '../../management-fees/entities/fee.entity';
import { CreateApprovalDto, ApproveApprovalDto } from '../dtos/create-approval.dto';

@Injectable()
export class ApprovalsService {
  constructor(
    @InjectRepository(Approval)
    private approvalRepository: Repository<Approval>,
    @InjectRepository(Fee)
    private feeRepository: Repository<Fee>,
  ) {}

  async createApproval(createApprovalDto: CreateApprovalDto): Promise<Approval> {
    const fee = await this.feeRepository.findOne({
      where: { id: createApprovalDto.feeId },
    });

    if (!fee) {
      throw new NotFoundException('Fee não encontrada');
    }

    const approval = this.approvalRepository.create({
      fee,
      approverName: createApprovalDto.approverName,
      approverEmail: createApprovalDto.approverEmail,
      status: 'PENDING_REVIEW',
    });

    return this.approvalRepository.save(approval);
  }

  async findAllApprovals(): Promise<Approval[]> {
    return this.approvalRepository.find({
      relations: { fee: { contract: true } },
      order: { createdAt: 'DESC' },
    });
  }

  async findApprovalById(id: string): Promise<Approval> {
    const approval = await this.approvalRepository.findOne({
      where: { id },
      relations: { fee: { contract: true } },
    });

    if (!approval) {
      throw new NotFoundException('Aprovação não encontrada');
    }

    return approval;
  }

  async findApprovalsByFee(feeId: string): Promise<Approval[]> {
    return this.approvalRepository.find({
      where: { fee: { id: feeId } },
      relations: { fee: { contract: true } },
      order: { createdAt: 'DESC' },
    });
  }

  async findApprovalsByStatus(status: 'APPROVED' | 'REJECTED' | 'PENDING_REVIEW'): Promise<Approval[]> {
    return this.approvalRepository.find({
      where: { status },
      relations: { fee: { contract: true } },
      order: { createdAt: 'DESC' },
    });
  }

  async approveApproval(
    id: string,
    approveDto: ApproveApprovalDto,
  ): Promise<Approval> {
    const approval = await this.findApprovalById(id);

    approval.status = approveDto.status;
    approval.comments = approveDto.comments;
    approval.approvedAt = new Date();

    if (approveDto.status === 'APPROVED') {
      approval.fee.status = 'APPROVED';
      await this.feeRepository.save(approval.fee);
    } else if (approveDto.status === 'REJECTED') {
      approval.fee.status = 'REJECTED';
      await this.feeRepository.save(approval.fee);
    }

    return this.approvalRepository.save(approval);
  }

  async getApprovalsAnalytics(): Promise<any> {
    const approvals = await this.approvalRepository.find();

    const analytics = {
      totalApprovals: approvals.length,
      pendingCount: approvals.filter((a) => a.status === 'PENDING_REVIEW').length,
      approvedCount: approvals.filter((a) => a.status === 'APPROVED').length,
      rejectedCount: approvals.filter((a) => a.status === 'REJECTED').length,
      approvalRate:
        approvals.length > 0
          ? (approvals.filter((a) => a.status === 'APPROVED').length /
              approvals.length) *
            100
          : 0,
    };

    return analytics;
  }
}
