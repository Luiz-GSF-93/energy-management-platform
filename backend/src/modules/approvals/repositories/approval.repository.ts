import { Injectable } from '@nestjs/common';
import { IRepository } from '../../../common/interfaces/repository.interface';

export interface Approval {
  id: string;
  feeId: string;
  approverName: string;
  approverEmail: string;
  status: string;
  comments?: string;
  approvedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

@Injectable()
export class ApprovalRepository implements IRepository<Approval> {
  private approvals: Map<string, Approval> = new Map();
  private idCounter = 1;

  async create(entity: Partial<Approval>): Promise<Approval> {
    const id = String(this.idCounter++);
    const approval: Approval = {
      id,
      feeId: entity.feeId || '',
      approverName: entity.approverName || '',
      approverEmail: entity.approverEmail || '',
      status: entity.status || 'PENDING_REVIEW',
      comments: entity.comments,
      approvedAt: entity.approvedAt,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    this.approvals.set(id, approval);
    return approval;
  }

  async findAll(): Promise<Approval[]> {
    return Array.from(this.approvals.values());
  }

  async findById(id: string): Promise<Approval | null> {
    return this.approvals.get(id) || null;
  }

  async update(id: string, entity: Partial<Approval>): Promise<Approval> {
    const approval = this.approvals.get(id);
    if (!approval) throw new Error('Approval not found');
    const updated = { ...approval, ...entity, updatedAt: new Date() };
    this.approvals.set(id, updated);
    return updated;
  }

  async delete(id: string): Promise<boolean> {
    return this.approvals.delete(id);
  }
}
