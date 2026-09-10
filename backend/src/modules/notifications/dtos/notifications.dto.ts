import { IsString, IsOptional, IsBoolean, IsEnum } from 'class-validator';

export class GetNotificationsDto {
  @IsOptional()
  @IsBoolean()
  unreadOnly?: boolean;

  @IsOptional()
  @IsEnum(['pending_approval', 'anomaly_detected', 'approval_completed', 'publication_ready', 'adjustment_requested'])
  type?: string;

  @IsOptional()
  @IsEnum(['critical', 'warning', 'info'])
  severity?: string;

  @IsOptional()
  @IsString()
  limit?: string;
}

export class MarkNotificationAsReadDto {
  @IsString()
  notificationId: string = '';
}

export class UpdateNotificationPreferencesDto {
  @IsOptional()
  @IsBoolean()
  emailNotifications?: boolean;

  @IsOptional()
  @IsBoolean()
  pushNotifications?: boolean;

  @IsOptional()
  @IsBoolean()
  inAppNotifications?: boolean;

  @IsOptional()
  @IsBoolean()
  notifyOnPendingApproval?: boolean;

  @IsOptional()
  @IsBoolean()
  notifyOnAnomalyDetected?: boolean;

  @IsOptional()
  @IsBoolean()
  notifyOnApprovalCompleted?: boolean;

  @IsOptional()
  @IsBoolean()
  notifyOnPublicationReady?: boolean;

  @IsOptional()
  @IsBoolean()
  notifyOnAdjustmentRequested?: boolean;
}

export class GetAlertsDto {
  @IsOptional()
  @IsEnum(['pending_settlements', 'critical_anomalies', 'approval_deadline', 'adjustment_overdue', 'publication_pending'])
  type?: string;

  @IsOptional()
  @IsEnum(['critical', 'warning', 'info'])
  severity?: string;

  @IsOptional()
  @IsBoolean()
  activeOnly?: boolean;
}
