import { Injectable } from '@nestjs/common';
import { SupabaseService } from '../../../services/supabase.service';
import {
  Invoice,
  RegulatedMarketSimulation,
  InvoiceComparison,
} from '../interfaces/invoices.interface';
import {
  CreateInvoiceDto,
  SimulateRegulatedMarketDto,
  UpdateInvoiceDto,
  GetInvoicesDto,
} from '../dtos/invoices.dto';

@Injectable()
export class InvoicesService {
  constructor(private supabaseService: SupabaseService) {}

  /**
   * Criar fatura
   */
  async createInvoice(dto: CreateInvoiceDto, userId: string): Promise<Invoice> {
    try {
      const client = this.supabaseService.getClient();

      // Calcular energyCost
      const energyCost = dto.consumptionKwh * dto.energyTariff;

      // Calcular demandCost se houver demanda
      const demandCost = dto.demandTariff && dto.demandKw ? dto.demandKw * dto.demandTariff : 0;

      // Subtotal antes de impostos
      const subtotal =
        energyCost +
        demandCost +
        dto.distributionCost +
        dto.transmissionCost +
        dto.tusd +
        dto.te;

      // Calcular impostos
      const taxes = dto.pis + dto.cofins + dto.icms;

      // Total
      const totalAmount = subtotal + taxes;

      const { data, error } = await client
        .from('invoices')
        .insert([
          {
            organization_id: dto.organizationId,
            consumer_unit_id: dto.consumerUnitId,
            energy_contract_id: dto.energyContractId,
            invoice_number: dto.invoiceNumber,
            issue_date: new Date(dto.issueDate).toISOString(),
            due_date: new Date(dto.dueDate).toISOString(),
            reference_month: new Date(dto.referenceMonth).toISOString(),
            status: 'draft',
            invoice_type: dto.invoiceType,
            consumption_kwh: dto.consumptionKwh,
            demand_kw: dto.demandKw || null,
            energy_tariff: dto.energyTariff,
            demand_tariff: dto.demandTariff || null,
            energy_cost: energyCost,
            demand_cost: demandCost || null,
            distribution_cost: dto.distributionCost,
            transmission_cost: dto.transmissionCost,
            pis: dto.pis,
            cofins: dto.cofins,
            icms: dto.icms,
            tusd: dto.tusd,
            te: dto.te,
            subtotal,
            taxes,
            total_amount: totalAmount,
            invoice_url: dto.invoiceUrl || null,
            notes: dto.notes || null,
            created_by: userId,
          },
        ])
        .select()
        .single();

      if (error) {
        throw error;
      }

      return this.mapInvoice(data);
    } catch (exception) {
      console.error('❌ Erro ao criar fatura:', exception);
      throw exception;
    }
  }

  /**
   * Obter faturas com filtros
   */
  async getInvoices(organizationId: string, filters: GetInvoicesDto): Promise<Invoice[]> {
    try {
      const client = this.supabaseService.getClient();

      let query = client
        .from('invoices')
        .select('*')
        .eq('organization_id', organizationId);

      if (filters.consumerUnitId) {
        query = query.eq('consumer_unit_id', filters.consumerUnitId);
      }

      if (filters.status) {
        query = query.eq('status', filters.status);
      }

      if (filters.startDate) {
        query = query.gte('reference_month', filters.startDate);
      }

      if (filters.endDate) {
        query = query.lte('reference_month', filters.endDate);
      }

      const limit = filters.limit ? parseInt(filters.limit, 10) : 50;

      const { data, error } = await query
        .order('reference_month', { ascending: false })
        .limit(limit);

      if (error) {
        throw error;
      }

      return ((data || []) as any[]).map((inv: any) => this.mapInvoice(inv));
    } catch (exception) {
      console.error('❌ Erro ao buscar faturas:', exception);
      return [];
    }
  }

  /**
   * Obter fatura por ID
   */
  async getInvoiceById(invoiceId: string): Promise<Invoice | null> {
    try {
      const client = this.supabaseService.getClient();

      const { data, error } = await client
        .from('invoices')
        .select('*')
        .eq('id', invoiceId)
        .single();

      if (error) {
        throw error;
      }

      return this.mapInvoice(data);
    } catch (exception) {
      console.error('❌ Erro ao buscar fatura:', exception);
      return null;
    }
  }

  /**
   * Atualizar fatura
   */
  async updateInvoice(invoiceId: string, dto: UpdateInvoiceDto): Promise<Invoice | null> {
    try {
      const client = this.supabaseService.getClient();

      const updateData: any = {};
      if (dto.status) updateData.status = dto.status;
      if (dto.paidAmount !== undefined) updateData.paid_amount = dto.paidAmount;
      if (dto.paidDate) updateData.paid_date = new Date(dto.paidDate).toISOString();
      if (dto.notes) updateData.notes = dto.notes;
      updateData.updated_at = new Date().toISOString();

      const { data, error } = await client
        .from('invoices')
        .update(updateData)
        .eq('id', invoiceId)
        .select()
        .single();

      if (error) {
        throw error;
      }

      return this.mapInvoice(data);
    } catch (exception) {
      console.error('❌ Erro ao atualizar fatura:', exception);
      return null;
    }
  }

  /**
   * Simular Mercado Regulado
   */
  async simulateRegulatedMarket(
    dto: SimulateRegulatedMarketDto
  ): Promise<RegulatedMarketSimulation> {
    try {
      // Cálculos base
      const energyCostCalculated = dto.consumptionKwh * ((dto.peakRate + dto.offPeakRate) / 2);
      const demandCostCalculated = dto.demandKw && dto.demandRate ? dto.demandKw * dto.demandRate : 0;

      // Distribuição e transmissão (estimados como % do consumo)
      const distributionCalculated = energyCostCalculated * 0.15;
      const transmissionCalculated = energyCostCalculated * 0.10;

      // Subtotal
      const subtotalBeforeTaxes =
        energyCostCalculated + demandCostCalculated + distributionCalculated + transmissionCalculated;

      // Encargos
      const pis = subtotalBeforeTaxes * dto.pisPercentage;
      const cofins = subtotalBeforeTaxes * dto.cofinsPercentage;
      const icms = subtotalBeforeTaxes * dto.icmsPercentage;
      const tusd = subtotalBeforeTaxes * dto.tusdPercentage;
      const te = subtotalBeforeTaxes * dto.tePercentage;

      const chargesTotal = pis + cofins + icms + tusd + te;
      const totalEstimated = subtotalBeforeTaxes + chargesTotal;

      return {
        consumerUnitId: dto.consumerUnitId,
        referenceMonth: new Date(dto.referenceMonth),
        consumptionKwh: dto.consumptionKwh,
        demandKw: dto.demandKw,
        energyTariffsBase: {
          peakRate: dto.peakRate,
          offPeakRate: dto.offPeakRate,
          demandRate: dto.demandRate,
        },
        energyCostCalculated,
        demandCostCalculated,
        distributionCalculated,
        transmissionCalculated,
        pisPercentage: dto.pisPercentage,
        cofinsPercentage: dto.cofinsPercentage,
        icmsPercentage: dto.icmsPercentage,
        tusdPercentage: dto.tusdPercentage,
        tePercentage: dto.tePercentage,
        subtotalBeforeTaxes,
        chargesTotal,
        totalEstimated,
      };
    } catch (exception) {
      console.error('❌ Erro ao simular mercado regulado:', exception);
      throw exception;
    }
  }

  /**
   * Comparar fatura com simulação
   */
  async compareInvoiceWithSimulation(
    invoiceId: string,
    simulation: RegulatedMarketSimulation
  ): Promise<InvoiceComparison> {
    try {
      const invoice = await this.getInvoiceById(invoiceId);
      if (!invoice) {
        throw new Error('Fatura não encontrada');
      }

      const regulatedMarketTotal = invoice.totalAmount;
      const freeMarketEstimated = simulation.totalEstimated;
      const potentialSavings = regulatedMarketTotal - freeMarketEstimated;
      const savingsPercentage =
        regulatedMarketTotal > 0 ? (potentialSavings / regulatedMarketTotal) * 100 : 0;

      const recommendation =
        potentialSavings > 0
          ? `Economia potencial de R$ ${potentialSavings.toFixed(2)} (${savingsPercentage.toFixed(1)}%)`
          : 'Mercado regulado é mais vantajoso';

      return {
        invoiceId,
        referenceMonth: new Date(invoice.referenceMonth),
        regulatedMarketTotal: regulatedMarketTotal,
        freeMarketEstimated,
        potentialSavings,
        savingsPercentage,
        recommendation,
      };
    } catch (exception) {
      console.error('❌ Erro ao comparar fatura:', exception);
      throw exception;
    }
  }

  /**
   * Mapear dados do Supabase para Invoice
   */
  private mapInvoice(data: any): Invoice {
    return {
      id: data.id,
      organizationId: data.organization_id,
      consumerUnitId: data.consumer_unit_id,
      energyContractId: data.energy_contract_id,
      invoiceNumber: data.invoice_number,
      issueDate: new Date(data.issue_date),
      dueDate: new Date(data.due_date),
      referenceMonth: new Date(data.reference_month),
      status: data.status,
      invoiceType: data.invoice_type,
      consumptionKwh: data.consumption_kwh,
      demandKw: data.demand_kw,
      energyTariff: data.energy_tariff,
      demandTariff: data.demand_tariff,
      energyCost: data.energy_cost,
      demandCost: data.demand_cost,
      distributionCost: data.distribution_cost,
      transmissionCost: data.transmission_cost,
      pis: data.pis,
      cofins: data.cofins,
      icms: data.icms,
      tusd: data.tusd,
      te: data.te,
      subtotal: data.subtotal,
      taxes: data.taxes,
      totalAmount: data.total_amount,
      paidAmount: data.paid_amount,
      paidDate: data.paid_date ? new Date(data.paid_date) : undefined,
      invoiceUrl: data.invoice_url,
      notes: data.notes,
      createdAt: new Date(data.created_at),
      updatedAt: new Date(data.updated_at),
      createdBy: data.created_by,
    };
  }
}
