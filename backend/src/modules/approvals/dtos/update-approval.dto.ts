import {
  IsString,
  IsEmail,
  IsEnum,
  IsOptional,
  IsUUID,
  Length,
} from 'class-validator';

export class UpdateApprovalDto {
  @IsOptional()
  @IsUUID('4', { message: 'Fee ID deve ser um UUID válido' })
  feeId?: string;

  @IsOptional()
  @IsString({ message: 'Nome do aprovador deve ser texto' })
  @Length(3, 100, { message: 'Nome deve ter entre 3 e 100 caracteres' })
  approverName?: string;

  @IsOptional()
  @IsEmail({}, { message: 'Email do aprovador deve ser válido' })
  approverEmail?: string;

  @IsOptional()
  @IsString({ message: 'Comentários deve ser texto' })
  @Length(10, 500, { message: 'Comentários deve ter entre 10 e 500 caracteres' })
  comments?: string;

  @IsOptional()
  @IsEnum(['APPROVED', 'REJECTED'], {
    message: 'Status deve ser APPROVED ou REJECTED',
  })
  status?: string;
}
