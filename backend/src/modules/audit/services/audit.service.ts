import { Injectable, Logger } from '@nestjs/common';
import { DataSource, Repository } from 'typeorm';
import { AuditLog } from '../entities/audit-log.entity';

@Injectable()
export class AuditService {
  private auditRepository: Repository<AuditLog>;
  private readonly logger = new Logger('AuditService');

  constructor(private dataSource: DataSource) {
    this.auditRepository = this.dataSource.getRepository(AuditLog);
  }

  async log(data: {
    entityType: string;
    entityId: string;
    action: 'CREATE' | 'UPDATE' | 'DELETE' | 'APPROVE' | 'REJECT' | 'ARCHIVE';
    userId?: string;
    userName?: string;
    description: string;
    oldValues?: Record<string, any>;
    newValues?: Record<string, any>;
    ipAddress?: string;
    userAgent?: string;
  }) {
    try {
      const auditLog = this.auditRepository.create({
        entityType: data.entityType,
        entityId: data.entityId,
        action: data.action,
        userId: data.userId,
        userName: data.userName || 'SYSTEM',
        description: data.description,
        oldValues: data.oldValues,
        newValues: data.newValues,
        ipAddress: data.ipAddress,
        userAgent: data.userAgent,
        approvalStatus: 'PENDING',
      });

      await this.auditRepository.save(auditLog);
      this.logger.log(
        `Auditoria: ${data.entityType} - ${data.action} - ${data.entityId}`,
      );
    } catch (error) {
      this.logger.error('Erro ao registrar auditoria', error);
    }
  }

  async approveAudit(
    auditId: string,
    approverId: string,
    approverName: string,
  ) {
    return await this.auditRepository.update(auditId, {
      approvalStatus: 'APPROVED',
      approverId,
      approverName,
      approvedAt: new Date(),
    });
  }

  async rejectAudit(
    auditId: string,
    approverId: string,
    approverName: string,
    reason: string,
  ) {
    return await this.auditRepository.update(auditId, {
      approvalStatus: 'REJECTED',
      approverId,
      approverName,
      rejectionReason: reason,
      approvedAt: new Date(),
    });
  }

  async findByEntity(
    entityType: string,
    entityId: string,
    limit: number = 50,
  ) {
    return await this.auditRepository.find({
      where: { entityType, entityId },
      order: { createdAt: 'DESC' },
      take: limit,
    });
  }

  async findPendingApprovals(limit: number = 100) {
    return await this.auditRepository.find({
      where: { approvalStatus: 'PENDING' },
      order: { createdAt: 'DESC' },
      take: limit,
    });
  }
}
