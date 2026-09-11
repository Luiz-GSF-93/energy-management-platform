import {
  IsString,
  IsNumber,
  IsDateString,
  IsEnum,
  IsOptional,
  IsUUID,
  Min,
  Max,
} from 'class-validator';

export class UpdateFeeDto {
  @IsOptional()
  @IsUUID('4', { message: 'Contract ID deve ser um UUID válido' })
  contractId?: string;

  @IsOptional()
  @IsDateString({}, { message: 'Mês de referência deve estar em formato ISO 8601' })
  referenceMonth?: string;

  @IsOptional()
  @IsNumber({}, { message: 'Taxa base deve ser um número' })
  @Min(0, { message: 'Taxa base não pode ser negativa' })
  baseFee?: number;

  @IsOptional()
  @IsNumber({}, { message: 'Economia de energia deve ser um número' })
  @Min(0, { message: 'Economia não pode ser negativa' })
  energySavings?: number;

  @IsOptional()
  @IsNumber({}, { message: 'Percentual de economia deve ser um número' })
  @Min(0, { message: 'Percentual não pode ser negativo' })
  @Max(100, { message: 'Percentual não pode exceder 100%' })
  savingsPercentage?: number;

  @IsOptional()
  @IsEnum(['PENDING', 'APPROVED', 'REJECTED', 'PAID'], {
    message: 'Status deve ser: PENDING, APPROVED, REJECTED ou PAID',
  })
  status?: string;
}
