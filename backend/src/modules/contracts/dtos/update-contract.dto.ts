import {
  IsString,
  IsNumber,
  IsDateString,
  IsEnum,
  IsOptional,
  Length,
  Min,
  Max,
} from 'class-validator';

export class UpdateContractDto {
  @IsOptional()
  @IsString({ message: 'Número do contrato deve ser texto' })
  @Length(3, 50, { message: 'Número deve ter entre 3 e 50 caracteres' })
  contractNumber?: string;

  @IsOptional()
  @IsString({ message: 'Título deve ser texto' })
  @Length(3, 100, { message: 'Título deve ter entre 3 e 100 caracteres' })
  contractTitle?: string;

  @IsOptional()
  @IsNumber({}, { message: 'Taxa mensal deve ser um número' })
  @Min(1, { message: 'Taxa mensal deve ser maior que 1' })
  monthlyFee?: number;

  @IsOptional()
  @IsNumber({}, { message: 'Comissão deve ser um número' })
  @Min(0, { message: 'Comissão não pode ser negativa' })
  @Max(100, { message: 'Comissão não pode exceder 100%' })
  commissionPercentage?: number;

  @IsOptional()
  @IsDateString({}, { message: 'Data de início deve estar no formato ISO 8601' })
  startDate?: string;

  @IsOptional()
  @IsDateString({}, { message: 'Data de fim deve estar no formato ISO 8601' })
  endDate?: string;

  @IsOptional()
  @IsEnum(['STANDARD', 'PREFERENCIAL'], {
    message: 'Tipo deve ser STANDARD ou PREFERENCIAL',
  })
  contractType?: string;

  @IsOptional()
  @IsString()
  customerId?: string;
}
