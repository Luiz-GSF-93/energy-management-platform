import { ArrayMaxSize, ArrayMinSize, ArrayUnique, Equals, IsISO8601, IsArray, IsIn, IsInt, IsObject, IsOptional, IsString, IsUUID, Length, Matches, Min } from 'class-validator';
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
export class AclStudySaveDto {
 @IsUUID() requestId!: string;
 @IsInt() @Min(1) expectedRevision!: number;
 @IsUUID() evidenceId!: string;
 @IsObject() proposal!: Record<string,unknown>;
 @Equals(true) checkedDocument!: boolean;
}
export class AclStudyReviewDto {
 @IsUUID() requestId!: string;
 @IsInt() @Min(1) expectedRevision!: number;
 @IsUUID() studyId!: string;
 @IsIn(['REVIEW','REJECT']) action!: string;
 @IsString() @Matches(/^[a-f0-9]{64}$/) hash!: string;
 @IsString() @Length(20,1000) reason!: string;
 @Equals(true) checkedDocument!: boolean;
}
export class AclEvidenceCommandDto {
  @IsUUID() requestId!: string;
  @IsInt() @Min(1) expectedRevision!: number;
  @IsIn(['SUBMIT','APPROVE','REJECT','COMPLETE','SKIP']) action!: string;
  @Equals(true) checkedDocument!: boolean;
  @IsOptional() @IsIn(stages) stageKey?: string;
  @IsOptional() @IsUUID() evidenceId?: string;
  @IsOptional() @IsIn(['COMPLETE','SKIP']) kind?: string;
  @IsOptional() @IsArray() @ArrayMinSize(1) @ArrayMaxSize(20) @ArrayUnique() @IsString({each:true}) @Length(1,100,{each:true}) @Matches(/^[A-Za-z0-9_-]+$/,{each:true}) documentIds?: string[];
  @IsOptional() @IsString() @Length(20,2000) note?: string;
  @IsOptional() @IsObject() facts?: Record<string,unknown>;
}
export class AclClosureCommandDto {
  @IsUUID() requestId!: string;
  @IsInt() @Min(1) expectedRevision!: number;
  @IsIn(['CLOSE','PUBLISH']) action!: string;
  @Equals(true) checkedDocument!: boolean;
  @IsOptional() @IsString() @Length(10,1000) conclusion?: string;
  @IsOptional() @IsString() @Matches(/^[a-f0-9]{64}$/) performanceHash?: string;
}
export class AclReopenDto {
  @IsUUID() requestId!: string;
  @IsInt() @Min(1) expectedRevision!: number;
  @IsString() @Length(20,1000) reason!: string;
  @Equals(true) checkedDocument!: boolean;
}

export class AclRequestDto {
 @IsUUID() requestId!: string;
 @IsInt() @Min(1) expectedRevision!: number;
 @IsIn(stages) stageKey!: string;
 @IsString() @Length(3,160) subject!: string;
 @IsString() @Length(10,5000) body!: string;
 @IsISO8601({strict:true}) dueAt!: string;
 @IsString() @Length(1,100) responsibleId!: string;
 @IsIn(['LOW','NORMAL','HIGH','URGENT']) priority!: string;
 @IsIn(['INVOICE','DOCUMENT','INFORMATION']) requestType!: string;
 @IsString() @Length(10,500) reason!: string;
 @Equals(true) checked!: boolean;
}
