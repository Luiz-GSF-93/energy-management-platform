export interface Notification {
  id: string;
  organizationId: string;
  userId: string;
  type: 'pending_approval' | 'anomaly_detected' | 'approval_completed' | 'publication_ready' | 'adjustment_requested';
  title: string;
  message: string;
  severity: 'critical' | 'warning' | 'info';
  relatedResourceId?: string;
  relatedResourceType?: string;
  isRead: boolean;
  createdAt: Date;
  readAt?: Date;
  actionUrl?: string;
}

export interface NotificationPreferences {
  id: string;
  userId: string;
  organizationId: string;
  emailNotifications: boolean;
  pushNotifications: boolean;
  inAppNotifications: boolean;
  notifyOnPendingApproval: boolean;
  notifyOnAnomalyDetected: boolean;
  notifyOnApprovalCompleted: boolean;
  notifyOnPublicationReady: boolean;
  notifyOnAdjustmentRequested: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface Alert {
  id: string;
  organizationId: string;
  type: 'pending_settlements' | 'critical_anomalies' | 'approval_deadline' | 'adjustment_overdue' | 'publication_pending';
  severity: 'critical' | 'warning' | 'info';
  title: string;
  description: string;
  count: number;
  metadata: Record<string, any>;
  isActive: boolean;
  createdAt: Date;
  resolvedAt?: Date;
}

export interface NotificationEvent {
  organizationId: string;
  userId: string;
  type: Notification['type'];
  title: string;
  message: string;
  severity: Notification['severity'];
  relatedResourceId?: string;
  relatedResourceType?: string;
  actionUrl?: string;
}
