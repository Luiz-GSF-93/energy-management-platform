import { IsString, IsUUID, Length, Matches } from 'class-validator';
export class CreateAclAdmissionDto {
  @IsUUID() requestId!: string;
  @IsString() @Length(1, 100) @Matches(/^[A-Za-z0-9_-]+$/) customerId!: string;
  @IsString() @Length(1, 100) @Matches(/^[A-Za-z0-9_-]+$/) unitId!: string;
}
