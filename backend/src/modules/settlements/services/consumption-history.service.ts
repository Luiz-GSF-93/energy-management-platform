import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { SupabaseService } from '../../../services/supabase.service';
import { CreateConsumptionHistoryDto } from '../dto/consumption-history.dto';

@Injectable()
export class ConsumptionHistoryService {
  constructor(private supabaseService: SupabaseService) {}

  async create(createConsumptionHistoryDto: CreateConsumptionHistoryDto) {
    const month = new Date(createConsumptionHistoryDto.month).toISOString().split('T')[0];

    const { data, error } = await this.supabaseService
      .getClient()
      .from('monthly_consumption_history')
      .insert([{ ...createConsumptionHistoryDto, month }])
      .select()
      .single();

    if (error) throw new BadRequestException(error.message);
    return data;
  }

  async findByConsumerUnit(consumerUnitId: string, year?: number) {
    let query = this.supabaseService
      .getClient()
      .from('monthly_consumption_history')
      .select('*')
      .eq('consumerUnitId', consumerUnitId)
      .is('deletedAt', null);

    if (year) {
      const startDate = `${year}-01-01`;
      const endDate = `${year}-12-31`;
      query = query.gte('month', startDate).lte('month', endDate);
    }

    const { data, error } = await query.order('month', { ascending: false });

    if (error) throw new BadRequestException(error.message);
    return data;
  }

  async getTrendAnalysis(consumerUnitId: string) {
    const { data, error } = await this.supabaseService
      .getClient()
      .from('monthly_consumption_history')
      .select('month, consumptionKwh')
      .eq('consumerUnitId', consumerUnitId)
      .is('deletedAt', null)
      .order('month', { ascending: true })
      .limit(24); // 24 meses

    if (error) throw new BadRequestException(error.message);

    // Calcular média, tendência, sazonalidade
    const values = (data as any[]).map(d => d.consumptionKwh);
    const avg = values.reduce((a, b) => a + b, 0) / values.length;
    const trend = this.calculateTrend(values);
    const seasonality = this.calculateSeasonality(values);

    return { average: avg, trend, seasonality, data };
  }

  private calculateTrend(values: number[]): number {
    // Simples: última - primeira / períodos
    if (values.length < 2) return 0;
    return (values[values.length - 1] - values[0]) / values.length;
  }

  private calculateSeasonality(values: number[]): any {
    // Agrupar por mês do ano
    if (values.length < 12) return {};
    const months = Array(12).fill(0).map(() => []);
    // Implementação simplificada
    return { note: 'Analysis pending full historical data' };
  }
}
