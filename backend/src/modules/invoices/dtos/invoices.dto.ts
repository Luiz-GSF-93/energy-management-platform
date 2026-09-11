import { IsString, IsNumber, IsOptional, IsDateString, IsEnum, IsArray, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

/**
 * DTO para criar fatura completa de concessionária
 * Inclui: consumo (TUSD/TE), demanda (ponta/fora-ponta), impostos, encargos, etc.
 */
export class CreateInvoiceDto {
  // ===== IDENTIFICAÇÃO E REFERÊNCIA =====
  @IsString()
  organizationId: string;

  @IsString()
  consumerUnitId: string; // UC (unidade consumidora)

  @IsString()
  energyContractId: string; // Contrato vinculado

  @IsString()
  invoiceNumber: string; // Número da fatura (ex: 123456789)

  @IsDateString()
  issueDate: string; // Data de emissão

  @IsDateString()
  dueDate: string; // Data de vencimento

  @IsDateString()
  referenceMonth: string; // Mês/ano referência (ex: 2026-01-01)

  @IsEnum(['regulated', 'free_market'])
  invoiceType: 'regulated' | 'free_market' = 'regulated';

  // ===== IDENTIFICAÇÃO DA CONCESSIONÁRIA =====
  @IsString()
  distributorName: string; // Ex: CPFL, Enel, Energisa, Cemig, Cepel

  @IsString()
  distributorCnpj: string; // CNPJ da distribuidora

  @IsString()
  consumerUnitNumber: string; // UC número completo (ex: 4001234567891)

  @IsString()
  meterNumber: string; // Número do medidor

  // ===== MODALIDADE TARIFÁRIA =====
  @IsEnum(['green', 'blue', 'white', 'conventional'])
  tariffModality: 'green' | 'blue' | 'white' | 'conventional' = 'conventional';

  // green = demanda única, blue = ponta + fora-ponta, white = horários variáveis

  // ===== CONSUMO (kWh) =====
  @IsNumber()
  consumptionKwhPeak: number = 0; // Consumo na ponta (modalidade Azul)

  @IsNumber()
  consumptionKwhOffPeak: number = 0; // Consumo fora de ponta (modalidade Azul/Verde)

  @IsNumber()
  totalConsumptionKwh: number = 0; // Total consumo (fallback para modalidade convencional)

  // ===== DEMANDA (kW) - Modalidade Azul =====
  @IsOptional()
  @IsNumber()
  demandKwPeak?: number; // Demanda na ponta (Azul)

  @IsOptional()
  @IsNumber()
  demandKwOffPeak?: number; // Demanda fora de ponta (Azul)

  @IsOptional()
  @IsNumber()
  demandKwBilled?: number; // Demanda cobrada (pode ser diferente da contratada)

  // ===== TARIFAS (R$/unidade) =====
  @IsNumber()
  tusdEnergyRatePeak: number = 0; // Tarifa TUSD energia - ponta (R$/kWh)

  @IsNumber()
  tusdEnergyRateOffPeak: number = 0; // Tarifa TUSD energia - fora de ponta (R$/kWh)

  @IsNumber()
  teEnergyRatePeak: number = 0; // Tarifa TE energia - ponta (R$/kWh)

  @IsNumber()
  teEnergyRateOffPeak: number = 0; // Tarifa TE energia - fora de ponta (R$/kWh)

  @IsOptional()
  @IsNumber()
  demandRatePeak?: number; // Tarifa demanda - ponta (R$/kW)

  @IsOptional()
  @IsNumber()
  demandRateOffPeak?: number; // Tarifa demanda - fora de ponta (R$/kW)

  // ===== CUSTOS CALCULADOS =====
  @IsNumber()
  tusdEnergyCostPeak: number = 0; // Custo TUSD energia ponta

  @IsNumber()
  tusdEnergyCostOffPeak: number = 0; // Custo TUSD energia fora de ponta

  @IsNumber()
  teEnergyCostPeak: number = 0; // Custo TE energia ponta

  @IsNumber()
  teEnergyCostOffPeak: number = 0; // Custo TE energia fora de ponta

  @IsOptional()
  @IsNumber()
  demandCostPeak?: number; // Custo demanda ponta

  @IsOptional()
  @IsNumber()
  demandCostOffPeak?: number; // Custo demanda fora de ponta

  // ===== ENCARGOS E CONTRIBUIÇÕES =====
  @IsOptional()
  @IsNumber()
  reservedEnergyCost?: number = 0; // Energia de Reserva (CER/CCEAR)

  @IsOptional()
  @IsNumber()
  chargesCost?: number = 0; // Encargos setoriais (RGR, P&D, PROINFA, etc)

  @IsOptional()
  @IsNumber()
  municipalTax?: number = 0; // Taxa municipal / iluminação pública

  // ===== IMPOSTOS (ICMS, PIS, COFINS) =====
  @IsNumber()
  icmsRate: number = 0.18; // Alíquota ICMS (%)

  @IsNumber()
  icmsValue: number = 0; // Valor ICMS (R$)

  @IsNumber()
  pisRate: number = 0.0765; // Alíquota PIS (%)

  @IsNumber()
  pisValue: number = 0; // Valor PIS (R$)

  @IsNumber()
  cofinsRate: number = 0.076; // Alíquota COFINS (%)

  @IsNumber()
  cofinsValue: number = 0; // Valor COFINS (R$)

  // ===== CRÉDITO E DESCONTOS =====
  @IsOptional()
  @IsNumber()
  previousCredit?: number = 0; // Crédito anterior (abatido)

  @IsOptional()
  @IsNumber()
  discount?: number = 0; // Desconto aplicado

  @IsOptional()
  @IsNumber()
  fine?: number = 0; // Multa por atraso

  @IsOptional()
  @IsNumber()
  interest?: number = 0; // Juros

  // ===== TOTALIZAÇÕES =====
  @IsNumber()
  subtotal: number = 0; // Subtotal antes de impostos

  @IsNumber()
  taxes: number = 0; // Total impostos (ICMS + PIS + COFINS)

  @IsNumber()
  totalAmount: number = 0; // Total a pagar

  // ===== STATUS E OBSERVAÇÕES =====
  @IsEnum(['draft', 'issued', 'paid', 'cancelled'])
  status: 'draft' | 'issued' | 'paid' | 'cancelled' = 'draft';

  @IsOptional()
  @IsDateString()
  paidDate?: string; // Data do pagamento

  @IsOptional()
  @IsNumber()
  paidAmount?: number; // Valor pago (pode ser diferente do total)

  @IsOptional()
  @IsString()
  invoiceUrl?: string; // URL/arquivo da fatura PDF

  @IsOptional()
  @IsString()
  notes?: string; // Observações/comentários

  // ===== COMPARATIVO REGULADO vs MERCADO LIVRE =====
  @IsOptional()
  @IsNumber()
  regulatedComparison?: number; // Valor se fosse em mercado regulado (para livre)

  @IsOptional()
  @IsString()
  marketComparison?: string; // Observações de comparativa
}

/**
 * DTO para simular fatura de mercado regulado
 */
export class SimulateRegulatedMarketDto {
  @IsString()
  consumerUnitId: string;

  @IsDateString()
  referenceMonth: string;

  // Consumo
  @IsNumber()
  consumptionKwhPeak: number = 0;

  @IsNumber()
  consumptionKwhOffPeak: number = 0;

  // Demanda
  @IsOptional()
  @IsNumber()
  demandKwPeak?: number;

  @IsOptional()
  @IsNumber()
  demandKwOffPeak?: number;

  // Tarifas reguladas
  @IsNumber()
  tusdRatePeak: number = 0;

  @IsNumber()
  tusdRateOffPeak: number = 0;

  @IsNumber()
  teRatePeak: number = 0;

  @IsNumber()
  teRateOffPeak: number = 0;

  @IsOptional()
  @IsNumber()
  demandRatePeak?: number;

  @IsOptional()
  @IsNumber()
  demandRateOffPeak?: number;

  // Impostos (%)
  @IsNumber()
  icmsPercentage: number = 0.18;

  @IsNumber()
  pisPercentage: number = 0.0765;

  @IsNumber()
  cofinsPercentage: number = 0.076;

  // Encargos
  @IsOptional()
  @IsNumber()
  chargesPercentage?: number = 0.10;
}

/**
 * DTO para atualizar fatura
 */
export class UpdateInvoiceDto {
  @IsOptional()
  @IsEnum(['draft', 'issued', 'paid', 'cancelled'])
  status?: 'draft' | 'issued' | 'paid' | 'cancelled';

  @IsOptional()
  @IsNumber()
  paidAmount?: number;

  @IsOptional()
  @IsDateString()
  paidDate?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}

/**
 * DTO para buscar faturas com filtros
 */
export class GetInvoicesDto {
  @IsOptional()
  @IsString()
  consumerUnitId?: string;

  @IsOptional()
  @IsEnum(['draft', 'issued', 'paid', 'cancelled'])
  status?: string;

  @IsOptional()
  @IsDateString()
  startDate?: string;

  @IsOptional()
  @IsDateString()
  endDate?: string;

  @IsOptional()
  @IsString()
  limit?: string;
}
