import { IsIn, IsInt, IsOptional, IsString, IsUUID, Length, Matches, Min } from 'class-validator';
export class CreateAclAdmissionDto {
  @IsUUID() requestId!: string;
  @IsString() @Length(1, 100) @Matches(/^[A-Za-z0-9_-]+$/) customerId!: string;
  @IsString() @Length(1, 100) @Matches(/^[A-Za-z0-9_-]+$/) unitId!: string;
}
const stages = ['registration','invoices','feasibility','modality','contracts','termination','metering','custody','technical','contract-registration','validation','supply'];
export class AclWorkCommandDto {
  @IsUUID() requestId!: string;
  @IsInt() @Min(1) expectedRevision!: number;
  @IsIn(stages) stageKey!: string;
  @IsIn(['START','PAUSE','RESUME']) action!: string;
  @IsOptional() @IsIn(['AWAITING_CUSTOMER','ENDING_ACTIVITY','OTHER']) pauseReason?: string;
  @IsOptional() @IsString() @Length(1,500) reason?: string;
}
export class AclHeartbeatDto {
  @IsIn(stages) stageKey!: string;
}
