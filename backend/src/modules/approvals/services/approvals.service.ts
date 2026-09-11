import { Injectable } from '@nestjs/common';
import { ApproveApprovalDto } from '../dtos/approve-approval.dto';

@Injectable()
export class ApprovalsService {
  private approvals: any[] = [];

  async createApproval(createApprovalDto: any) {
    const approval = {
      id: Math.random().toString(36).substr(2, 9),
      ...createApprovalDto,
      status: 'PENDING_REVIEW',
      createdAt: new Date(),
    };
    this.approvals.push(approval);
    return approval;
  }

  async findAllApprovals() {
    return this.approvals;
  }

  async findApprovalById(id: string) {
    return this.approvals.find(a => a.id === id);
  }

  async findApprovalsByStatus(status: string) {
    return this.approvals.filter(a => a.status === status);
  }

  async findApprovalsByFee(feeId: string) {
    return this.approvals.filter(a => a.feeId === feeId);
  }

  async approveApproval(id: string, approveApprovalDto: ApproveApprovalDto) {
    const approval = this.approvals.find(a => a.id === id);
    if (approval) {
      approval.status = approveApprovalDto.status;
      approval.comments = approveApprovalDto.comments;
      approval.approvedAt = new Date();
    }
    return approval;
  }

  async getApprovalsAnalytics() {
    const total = this.approvals.length;
    const approved = this.approvals.filter(a => a.status === 'APPROVED').length;
    const rejected = this.approvals.filter(a => a.status === 'REJECTED').length;
    const pending = this.approvals.filter(a => a.status === 'PENDING_REVIEW').length;

    const approvalRate = total > 0 ? ((approved / total) * 100).toFixed(2) : '0.00';

    return {
      total,
      approved,
      rejected,
      pending,
      approvalRate: `${approvalRate}%`,
    };
  }
}
