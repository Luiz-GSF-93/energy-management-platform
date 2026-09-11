import { Injectable, NotFoundException } from '@nestjs/common';
import { SupabaseService } from '../../../services/supabase.service';
import {
  Invoice,
  RegulatedMarketSimulation,
  InvoiceComparison,
  PerformanceMetrics,
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
   * Criar fatura completa aproveitando dados do Contrato
   */
  async createInvoiceFromContract(
    contractId: string,
    consumerUnitId: string,
    referenceMonth: Date,
    consumptionData: any,
    userId: string,
  ): Promise<Invoice> {
    try {
      const client = this.supabaseService.getClient();

      // 1. Buscar contrato para obter tarifas
      const { data: contract, error: contractError } = await client
        .from('contracts')
        .select('*')
        .eq('id', contractId)
        .single();

      if (contractError || !contract) {
        throw new NotFoundException(`Contrato ${contractId} não encontrado`);
      }

      // 2. Buscar UC para obter dados básicos
      const { data: consumerUnit, error: ucError } = await client
        .from('consumer_units')
        .select('*')
        .eq('id', consumerUnitId)
        .single();

      if (ucError || !consumerUnit) {
        throw new NotFoundException(`UC ${consumerUnitId} não encontrada`);
      }

      // 3. Montar DTO com dados do contrato (com TODOS os campos obrigatórios)
      const invoiceDto: CreateInvoiceDto = {
        organizationId: contract.organization_id,
        consumerUnitId,
        energyContractId: contractId,
        invoiceNumber: this.generateInvoiceNumber(),
        issueDate: new Date().toISOString(),
        dueDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
        referenceMonth: referenceMonth.toISOString(),
        invoiceType: contract.purchase_modality === 'FREE_MARKET' ? 'free_market' : 'regulated',
        status: 'draft',

        // Distribuidor
        distributorName: consumerUnit.distributor_name || 'Distribuidor',
        distributorCnpj: consumerUnit.distributor_cnpj || '',
        consumerUnitNumber: consumerUnit.consumer_unit_number || '',
        meterNumber: consumerUnit.meter_number || '',

        // Modalidade tarifária
        tariffModality: this.mapTariffModality(consumerUnit.tariff_modality),

        // Consumo (do mês)
        consumptionKwhPeak: consumptionData.kwhPeak || 0,
        consumptionKwhOffPeak: consumptionData.kwhOffPeak || 0,
        totalConsumptionKwh: (consumptionData.kwhPeak || 0) + (consumptionData.kwhOffPeak || 0),

        // Demanda
        demandKwPeak: consumptionData.demandKwPeak,
        demandKwOffPeak: consumptionData.demandKwOffPeak,
        demandKwBilled: consumptionData.demandKwBilled,

        // Tarifas do contrato
        tusdEnergyRatePeak: parseFloat(contract.tusd_energy_rate_peak || '0'),
        tusdEnergyRateOffPeak: parseFloat(contract.tusd_energy_rate_off_peak || '0'),
        teEnergyRatePeak: parseFloat(contract.te_energy_rate_peak || '0'),
        teEnergyRateOffPeak: parseFloat(contract.te_energy_rate_off_peak || '0'),
        demandRatePeak: contract.demand_rate_peak ? parseFloat(contract.demand_rate_peak) : undefined,
        demandRateOffPeak: contract.demand_rate_off_peak ? parseFloat(contract.demand_rate_off_peak) : undefined,

        // Custos (calculados)
        tusdEnergyCostPeak: 0,
        tusdEnergyCostOffPeak: 0,
        teEnergyCostPeak: 0,
        teEnergyCostOffPeak: 0,
        demandCostPeak: 0,
        demandCostOffPeak: 0,

        // Encargos
        reservedEnergyCost: consumptionData.chargesCost || 0,
        chargesCost: consumptionData.chargesCost || 0,
        municipalTax: consumptionData.municipalTax || 0,

        // Impostos (taxas padrão)
        icmsRate: 0.18,
        icmsValue: 0,
        pisRate: 0.0765,
        pisValue: 0,
        cofinsRate: 0.076,
        cofinsValue: 0,

        // Crédito e descontos
        previousCredit: 0,
        discount: 0,
        fine: 0,
        interest: 0,

        // Totalizações (serão calculadas)
        subtotal: 0,
        taxes: 0,
        totalAmount: 0,
      };

      // 4. Calcular custos
      const calculatedInvoice = this.calculateInvoiceTotal(invoiceDto);

      // 5. Salvar no banco
      const { data, error } = await client
        .from('invoices')
        .insert([{
          organization_id: calculatedInvoice.organizationId,
          consumer_unit_id: calculatedInvoice.consumerUnitId,
          energy_contract_id: calculatedInvoice.energyContractId,
          invoice_number: calculatedInvoice.invoiceNumber,
          issue_date: calculatedInvoice.issueDate,
          due_date: calculatedInvoice.dueDate,
          reference_month: calculatedInvoice.referenceMonth,
          status: calculatedInvoice.status,
          invoice_type: calculatedInvoice.invoiceType,
          distributor_name: calculatedInvoice.distributorName,
          distributor_cnpj: calculatedInvoice.distributorCnpj,
          consumer_unit_number: calculatedInvoice.consumerUnitNumber,
          meter_number: calculatedInvoice.meterNumber,
          tariff_modality: calculatedInvoice.tariffModality,
          consumption_kwh_peak: calculatedInvoice.consumptionKwhPeak,
          consumption_kwh_off_peak: calculatedInvoice.consumptionKwhOffPeak,
          total_consumption_kwh: calculatedInvoice.totalConsumptionKwh,
          demand_kw_peak: calculatedInvoice.demandKwPeak,
          demand_kw_off_peak: calculatedInvoice.demandKwOffPeak,
          demand_kw_billed: calculatedInvoice.demandKwBilled,
          tusd_energy_rate_peak: calculatedInvoice.tusdEnergyRatePeak,
          tusd_energy_rate_off_peak: calculatedInvoice.tusdEnergyRateOffPeak,
          te_energy_rate_peak: calculatedInvoice.teEnergyRatePeak,
          te_energy_rate_off_peak: calculatedInvoice.teEnergyRateOffPeak,
          demand_rate_peak: calculatedInvoice.demandRatePeak,
          demand_rate_off_peak: calculatedInvoice.demandRateOffPeak,
          tusd_energy_cost_peak: calculatedInvoice.tusdEnergyCostPeak,
          tusd_energy_cost_off_peak: calculatedInvoice.tusdEnergyCostOffPeak,
          te_energy_cost_peak: calculatedInvoice.teEnergyCostPeak,
          te_energy_cost_off_peak: calculatedInvoice.teEnergyCostOffPeak,
          demand_cost_peak: calculatedInvoice.demandCostPeak,
          demand_cost_off_peak: calculatedInvoice.demandCostOffPeak,
          reserved_energy_cost: calculatedInvoice.reservedEnergyCost,
          charges_cost: calculatedInvoice.chargesCost,
          municipal_tax: calculatedInvoice.municipalTax,
          icms_rate: calculatedInvoice.icmsRate,
          icms_value: calculatedInvoice.icmsValue,
          pis_rate: calculatedInvoice.pisRate,
          pis_value: calculatedInvoice.pisValue,
          cofins_rate: calculatedInvoice.cofinsRate,
          cofins_value: calculatedInvoice.cofinsValue,
          previous_credit: calculatedInvoice.previousCredit,
          discount: calculatedInvoice.discount,
          fine: calculatedInvoice.fine,
          interest: calculatedInvoice.interest,
          subtotal: calculatedInvoice.subtotal,
          taxes: calculatedInvoice.taxes,
          total_amount: calculatedInvoice.totalAmount,
          created_by: userId,
        }])
        .select()
        .single();

      if (error) throw error;
      console.log('✅ Fatura criada e integrada com contrato:', data.id);
      return this.mapInvoice(data);
    } catch (exception) {
      console.error('❌ Erro ao criar fatura:', exception);
      throw exception;
    }
  }

  /**
   * Calcular total da fatura com todos os impostos e encargos
   */
  calculateInvoiceTotal(dto: CreateInvoiceDto): CreateInvoiceDto {
    // 1. Custos de TUSD e TE
    const tusdEnergyCostPeak = dto.consumptionKwhPeak * dto.tusdEnergyRatePeak;
    const tusdEnergyCostOffPeak = dto.consumptionKwhOffPeak * dto.tusdEnergyRateOffPeak;
    const teEnergyCostPeak = dto.consumptionKwhPeak * dto.teEnergyRatePeak;
    const teEnergyCostOffPeak = dto.consumptionKwhOffPeak * dto.teEnergyRateOffPeak;

    // 2. Custos de Demanda
    const demandCostPeak = (dto.demandKwPeak || 0) * (dto.demandRatePeak || 0);
    const demandCostOffPeak = (dto.demandKwOffPeak || 0) * (dto.demandRateOffPeak || 0);

    // 3. Subtotal antes de impostos
    const subtotal =
      tusdEnergyCostPeak +
      tusdEnergyCostOffPeak +
      teEnergyCostPeak +
      teEnergyCostOffPeak +
      demandCostPeak +
      demandCostOffPeak +
      (dto.reservedEnergyCost || 0) +
      (dto.chargesCost || 0) +
      (dto.municipalTax || 0) +
      (dto.fine || 0) +
      (dto.interest || 0);

    // 4. Impostos
    const icmsValue = subtotal * dto.icmsRate;
    const pisValue = subtotal * dto.pisRate;
    const cofinsValue = subtotal * dto.cofinsRate;
    const taxes = icmsValue + pisValue + cofinsValue;

    // 5. Total
    const totalBeforeCredit = subtotal + taxes;
    const totalAmount = Math.max(0, totalBeforeCredit - (dto.previousCredit || 0) - (dto.discount || 0));

    return {
      ...dto,
      tusdEnergyCostPeak,
      tusdEnergyCostOffPeak,
      teEnergyCostPeak,
      teEnergyCostOffPeak,
      demandCostPeak,
      demandCostOffPeak,
      icmsValue,
      pisValue,
      cofinsValue,
      subtotal,
      taxes,
      totalAmount,
    };
  }

  /**
   * Comparar fatura com cenário de mercado regulado
   */
  async compareWithRegulatedMarket(invoiceId: string, simulationDto: SimulateRegulatedMarketDto): Promise<InvoiceComparison> {
    try {
      const client = this.supabaseService.getClient();
      
      // Buscar fatura
      const { data: invoice, error: invoiceError } = await client
        .from('invoices')
        .select('*')
        .eq('id', invoiceId)
        .single();

      if (invoiceError || !invoice) {
        throw new NotFoundException(`Fatura ${invoiceId} não encontrada`);
      }

      // Calcular custo regulado
      const regulatedEnergy =
        invoice.consumption_kwh_peak * simulationDto.tusdRatePeak +
        invoice.consumption_kwh_off_peak * simulationDto.tusdRateOffPeak +
        invoice.consumption_kwh_peak * simulationDto.teRatePeak +
        invoice.consumption_kwh_off_peak * simulationDto.teRateOffPeak;

      const regulatedDemand =
        (invoice.demand_kw_peak || 0) * (simulationDto.demandRatePeak || 0) +
        (invoice.demand_kw_off_peak || 0) * (simulationDto.demandRateOffPeak || 0);

      const regulatedSubtotal = regulatedEnergy + regulatedDemand + (invoice.charges_cost || 0);
      const regulatedTaxes =
        regulatedSubtotal * simulationDto.icmsPercentage +
        regulatedSubtotal * simulationDto.pisPercentage +
        regulatedSubtotal * simulationDto.cofinsPercentage;

      const regulatedTotal = regulatedSubtotal + regulatedTaxes;

      // Comparativa
      const potentialSavings = regulatedTotal - invoice.total_amount;
      const savingsPercentage = (potentialSavings / regulatedTotal) * 100;

      const recommendation =
        savingsPercentage > 15
          ? '🟢 Alto potencial de economia no mercado livre'
          : savingsPercentage > 5
          ? '🟡 Potencial moderado de economia'
          : '🔴 Sem benefício em migração para mercado livre';

      const comparison: InvoiceComparison = {
        invoiceId,
        referenceMonth: new Date(invoice.reference_month),
        regulatedMarketTotal: regulatedTotal,
        freeMarketEstimated: invoice.total_amount,
        potentialSavings,
        savingsPercentage,
        recommendation,
      };

      console.log('✅ Comparativa calculada:', comparison);
      return comparison;
    } catch (exception) {
      console.error('❌ Erro ao comparar com mercado regulado:', exception);
      throw exception;
    }
  }

  /**
   * Obter métricas de performance (para gráficos)
   */
  async getPerformanceMetrics(
    consumerUnitId: string,
    organizationId: string,
    startDate: Date,
    endDate: Date,
  ): Promise<PerformanceMetrics[]> {
    try {
      const client = this.supabaseService.getClient();

      const { data, error } = await client
        .from('invoices')
        .select('*')
        .eq('consumer_unit_id', consumerUnitId)
        .eq('organization_id', organizationId)
        .gte('reference_month', startDate.toISOString())
        .lte('reference_month', endDate.toISOString())
        .order('reference_month', { ascending: true });

      if (error) throw error;

      const metrics: PerformanceMetrics[] = ((data || []) as any[]).map((inv) => {
        const savings = Math.max(0, (inv.regulated_comparison || inv.total_amount) - inv.total_amount);
        const savingsPercentage = inv.regulated_comparison > 0 
          ? (savings / inv.regulated_comparison) * 100 
          : 0;

        return {
          period: new Date(inv.reference_month).toISOString().split('T')[0],
          consumption: inv.total_consumption_kwh || 0,
          regulatedCost: inv.regulated_comparison || inv.total_amount,
          freeMarketCost: inv.total_amount,
          savings,
          savingsPercentage,
          roi: (savings / inv.total_amount) * 100,
        };
      });

      console.log('✅ Métricas de performance obtidas:', metrics.length);
      return metrics;
    } catch (exception) {
      console.error('❌ Erro ao obter métricas:', exception);
      return [];
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

      if (filters.consumerUnitId) query = query.eq('consumer_unit_id', filters.consumerUnitId);
      if (filters.status) query = query.eq('status', filters.status);
      if (filters.startDate) query = query.gte('reference_month', filters.startDate);
      if (filters.endDate) query = query.lte('reference_month', filters.endDate);

      const limit = filters.limit ? parseInt(filters.limit, 10) : 50;
      const { data, error } = await query.order('reference_month', { ascending: false }).limit(limit);

      if (error) throw error;
      return ((data || []) as any[]).map(inv => this.mapInvoice(inv));
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
      const { data, error } = await client.from('invoices').select('*').eq('id', invoiceId).single();

      if (error) throw error;
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

      const { data, error } = await client
        .from('invoices')
        .update(updateData)
        .eq('id', invoiceId)
        .select()
        .single();

      if (error) throw error;
      console.log('✅ Fatura atualizada:', invoiceId);
      return this.mapInvoice(data);
    } catch (exception) {
      console.error('❌ Erro ao atualizar fatura:', exception);
      return null;
    }
  }

  /**
   * Gerar número de fatura
   */
  private generateInvoiceNumber(): string {
    const timestamp = Date.now().toString();
    const random = Math.floor(Math.random() * 10000).toString().padStart(4, '0');
    return `INV-${timestamp.slice(-8)}-${random}`;
  }

  /**
   * Mapear modalidade tarifária
   */
  private mapTariffModality(modality: string | undefined): 'green' | 'blue' | 'white' | 'conventional' {
    if (!modality) return 'conventional';
    if (modality.toLowerCase().includes('azul')) return 'blue';
    if (modality.toLowerCase().includes('verde')) return 'green';
    if (modality.toLowerCase().includes('white')) return 'white';
    return 'conventional';
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
      distributorName: data.distributor_name,
      distributorCnpj: data.distributor_cnpj,
      consumerUnitNumber: data.consumer_unit_number,
      meterNumber: data.meter_number,
      tariffModality: data.tariff_modality,
      consumptionKwhPeak: parseFloat(data.consumption_kwh_peak || 0),
      consumptionKwhOffPeak: parseFloat(data.consumption_kwh_off_peak || 0),
      totalConsumptionKwh: parseFloat(data.total_consumption_kwh || 0),
      demandKwPeak: data.demand_kw_peak ? parseFloat(data.demand_kw_peak) : undefined,
      demandKwOffPeak: data.demand_kw_off_peak ? parseFloat(data.demand_kw_off_peak) : undefined,
      demandKwBilled: data.demand_kw_billed ? parseFloat(data.demand_kw_billed) : undefined,
      tusdEnergyRatePeak: parseFloat(data.tusd_energy_rate_peak || 0),
      tusdEnergyRateOffPeak: parseFloat(data.tusd_energy_rate_off_peak || 0),
      teEnergyRatePeak: parseFloat(data.te_energy_rate_peak || 0),
      teEnergyRateOffPeak: parseFloat(data.te_energy_rate_off_peak || 0),
      demandRatePeak: data.demand_rate_peak ? parseFloat(data.demand_rate_peak) : undefined,
      demandRateOffPeak: data.demand_rate_off_peak ? parseFloat(data.demand_rate_off_peak) : undefined,
      tusdEnergyCostPeak: parseFloat(data.tusd_energy_cost_peak || 0),
      tusdEnergyCostOffPeak: parseFloat(data.tusd_energy_cost_off_peak || 0),
      teEnergyCostPeak: parseFloat(data.te_energy_cost_peak || 0),
      teEnergyCostOffPeak: parseFloat(data.te_energy_cost_off_peak || 0),
      demandCostPeak: data.demand_cost_peak ? parseFloat(data.demand_cost_peak) : undefined,
      demandCostOffPeak: data.demand_cost_off_peak ? parseFloat(data.demand_cost_off_peak) : undefined,
      reservedEnergyCost: data.reserved_energy_cost ? parseFloat(data.reserved_energy_cost) : undefined,
      chargesCost: data.charges_cost ? parseFloat(data.charges_cost) : undefined,
      municipalTax: data.municipal_tax ? parseFloat(data.municipal_tax) : undefined,
      icmsRate: parseFloat(data.icms_rate || 0.18),
      icmsValue: parseFloat(data.icms_value || 0),
      pisRate: parseFloat(data.pis_rate || 0.0765),
      pisValue: parseFloat(data.pis_value || 0),
      cofinsRate: parseFloat(data.cofins_rate || 0.076),
      cofinsValue: parseFloat(data.cofins_value || 0),
      previousCredit: data.previous_credit ? parseFloat(data.previous_credit) : undefined,
      discount: data.discount ? parseFloat(data.discount) : undefined,
      fine: data.fine ? parseFloat(data.fine) : undefined,
      interest: data.interest ? parseFloat(data.interest) : undefined,
      subtotal: parseFloat(data.subtotal || 0),
      taxes: parseFloat(data.taxes || 0),
      totalAmount: parseFloat(data.total_amount || 0),
      paidAmount: data.paid_amount ? parseFloat(data.paid_amount) : undefined,
      paidDate: data.paid_date ? new Date(data.paid_date) : undefined,
      invoiceUrl: data.invoice_url,
      notes: data.notes,
      regulatedComparison: data.regulated_comparison ? parseFloat(data.regulated_comparison) : undefined,
      marketComparison: data.market_comparison,
      createdAt: new Date(data.created_at),
      updatedAt: new Date(data.updated_at),
      createdBy: data.created_by,
    };
  }
}
