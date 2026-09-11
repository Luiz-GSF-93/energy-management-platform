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

export class CreateContractDto {
  // ==================== INFORMAÇÕES GERAIS ====================
  @IsString({ message: 'Número do contrato deve ser texto' })
  @Length(3, 50, { message: 'Número deve ter entre 3 e 50 caracteres' })
  contractNumber: string;

  @IsString({ message: 'Título deve ser texto' })
  @Length(3, 100, { message: 'Título deve ter entre 3 e 100 caracteres' })
  contractTitle: string;

  @IsDateString({}, { message: 'Data de início deve estar no formato ISO 8601' })
  startDate: string;

  @IsOptional()
  @IsDateString({}, { message: 'Data de fim deve estar no formato ISO 8601' })
  endDate?: string;

  @IsOptional()
  @IsString()
  observations?: string;

  // ==================== PARTES DO CONTRATO ====================
  @IsOptional()
  @IsString()
  customerId?: string;

  @IsString({ message: 'Fornecedor é obrigatório' })
  @Length(3, 100)
  supplierName: string;

  @IsOptional()
  @IsString()
  supplierCnpj?: string;

  @IsOptional()
  @IsString()
  distributorName?: string;

  @IsOptional()
  @IsString()
  distributorCnpj?: string;

  @IsOptional()
  @IsString()
  supplierContact?: string;

  @IsOptional()
  @IsString()
  supplierEmail?: string;

  @IsOptional()
  @IsString()
  supplierPhone?: string;

  // ==================== ENERGIA E VOLUME ====================
  @IsNumber({}, { message: 'MWh anual deve ser um número' })
  @Min(0.01)
  contractedMwhAnnual: number;

  @IsNumber({}, { message: 'Sazonalidade deve ser um número (%)' })
  @Min(0)
  @Max(100)
  seasonality: number;

  @IsOptional()
  @IsNumber({}, { message: 'Flexibilidade deve ser um número (%)' })
  @Min(0)
  @Max(100)
  flexibility?: number;

  @IsNumber({}, { message: 'Demanda deve ser um número' })
  @Min(0)
  demandKw: number;

  @IsOptional()
  @IsString()
  consumerUnits?: string;

  // ==================== PRECIFICAÇÃO ====================
  @IsNumber({}, { message: 'Preço unitário deve ser um número' })
  @Min(0)
  pricePerMwh: number;

  @IsNumber({}, { message: 'Preço regulado deve ser um número' })
  @Min(0)
  regulatedPrice: number;

  @IsOptional()
  @IsNumber({}, { message: 'TUSD deve ser um número' })
  @Min(0)
  tusdComponent?: number;

  @IsOptional()
  @IsNumber({}, { message: 'ICMS deve ser um número (%)' })
  @Min(0)
  @Max(100)
  icmsPercentage?: number;

  @IsNumber({}, { message: 'Taxa mensal deve ser um número' })
  @Min(0)
  monthlyFee: number;

  // ==================== REAJUSTES ====================
  @IsOptional()
  @IsEnum(['IPCA', 'IGP-M', 'TR', 'FIXA'])
  adjustmentIndex?: string;

  @IsOptional()
  @IsDateString()
  adjustmentDate?: string;

  @IsOptional()
  @IsNumber({}, { message: 'Percentual de reajuste deve ser um número' })
  @Min(0)
  @Max(100)
  adjustmentPercentage?: number;

  @IsOptional()
  @IsNumber({}, { message: 'Cap de reajuste deve ser um número (%)' })
  adjustmentCap?: number;

  @IsOptional()
  @IsNumber({}, { message: 'Floor de reajuste deve ser um número (%)' })
  adjustmentFloor?: number;

  // ==================== FLEXIBILIDADE E MECANISMOS ====================
  @IsOptional()
  @IsNumber({}, { message: 'Variação permitida deve ser um número (%)' })
  @Min(0)
  @Max(100)
  variationAllowed?: number;

  @IsOptional()
  takeOrPayEnabled?: boolean;

  @IsOptional()
  @IsNumber({}, { message: 'Penalidade deve ser um número' })
  @Min(0)
  penaltyPercentage?: number;

  @IsOptional()
  @IsNumber({}, { message: 'Pré-aviso deve ser um número (dias)' })
  @Min(0)
  noticeTermDays?: number;

  // ==================== CONDIÇÕES COMERCIAIS ====================
  @IsEnum(['MONTHLY', 'ANNUAL'])
  billingFrequency: string;

  @IsOptional()
  @IsEnum(['BOLETO', 'TED', 'PIX', 'FATURA'])
  paymentMethod?: string;

  @IsOptional()
  @IsNumber({}, { message: 'Dias carência deve ser um número' })
  @Min(0)
  dueCardancyDays?: number;

  @IsOptional()
  @IsString()
  currency?: string;

  // ==================== CONFIGURAÇÃO ====================
  @IsEnum(['STANDARD', 'PREFERENCIAL'])
  contractType: string;

  @IsEnum(['ACTIVE', 'INACTIVE', 'SUSPENDED', 'TERMINATED'], {
    message: 'Status deve ser ACTIVE, INACTIVE, SUSPENDED ou TERMINATED',
  })
  @IsOptional()
  status?: string;

  @IsEnum(['FREE_MARKET', 'BILATERAL', 'CONVENTIONAL'])
  purchaseModality: string;

  @IsNumber({}, { message: 'Comissão deve ser um número' })
  @Min(0)
  @Max(100)
  commissionPercentage: number;
}
