export interface AuditLog {
  id: string;
  organizationId: string;
  userId?: string;
  resourceType: string;
  resourceId: string;
  action: string;
  changes?: Record<string, any>;
  timestamp?: Date;
  ipAddress?: string;
  userAgent?: string;
  createdAt?: Date;
}

export interface AuditSettlementTimeline {
  settlementId: string;
  month: Date;
  status: string;
  validationStatus: string;
  timeline: AuditTimelineEntry[];
  summary: {
    created: Date;
    lastModified: Date;
    approvedBy?: string;
    approvedAt?: Date;
    totalAdjustments: number;
    totalVersions: number;
  };
}

export interface AuditTimelineEntry {
  timestamp: Date;
  type: 'created' | 'validated' | 'adjusted' | 'approved' | 'published' | 'versioned';
  actor: string;
  actorName?: string;
  description: string;
  changes?: Record<string, any>;
  metadata?: Record<string, any>;
}

export interface AdjustmentRecord {
  id: string;
  settlementId: string;
  energyContractId: string;
  adjustmentType: string;
  originalValue: number;
  adjustedValue: number;
  adjustmentAmount: number;
  reason: string;
  justification?: string;
  approvedBy?: string;
  approvalDate?: Date;
  status: string;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface SettlementVersion {
  id: string;
  settlementId: string;
  versionNumber: number;
  data: Record<string, any>;
  reason?: string;
  createdBy?: string;
  createdAt?: Date;
}

export interface ApprovalRequest {
  settlementId: string;
  approvalType: 'validation' | 'adjustment' | 'publication';
  notes?: string;
}

export interface ApprovalResponse {
  success: boolean;
  settlementId: string;
  approvedBy: string;
  approvedAt: Date;
  message: string;
}
