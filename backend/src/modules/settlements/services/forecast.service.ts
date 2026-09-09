import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { SupabaseService } from '../../../services/supabase.service';
import { ForecastDto } from '../dto/forecast.dto';

@Injectable()
export class ForecastService {
  constructor(private supabaseService: SupabaseService) {}

  async create(dto: ForecastDto) {
    const { data, error } = await this.supabaseService
      .getClient()
      .from('consumption_forecasts')
      .insert([dto])
      .select();
    if (error) throw new BadRequestException(error.message);
    return data?.[0];
  }

  async generateForecast(consumerUnitId: string) {
    const { data: history } = await this.supabaseService
      .getClient()
      .from('monthly_consumption_history')
      .select('consumption_kwh')
      .eq('consumer_unit_id', consumerUnitId)
      .order('month', { ascending: false })
      .limit(12);

    const historyArray = history || [];
    const avg = historyArray.length > 0
      ? historyArray.reduce((sum: number, r: any) => sum + (r.consumption_kwh || 0), 0) / historyArray.length
      : 0;

    const nextMonth = new Date();
    nextMonth.setMonth(nextMonth.getMonth() + 1);

    const { data, error } = await this.supabaseService
      .getClient()
      .from('consumption_forecasts')
      .insert([
        {
          consumer_unit_id: consumerUnitId,
          forecast_month: nextMonth.toISOString().split('T')[0],
          base_scenario: avg,
          optimistic_scenario: avg * 1.1,
          pessimistic_scenario: avg * 0.9,
          confidence_level: 0.85,
        },
      ])
      .select();
    if (error) throw new BadRequestException(error.message);
    return data?.[0];
  }

  async findByConsumerUnit(consumerUnitId: string) {
    const { data, error } = await this.supabaseService
      .getClient()
      .from('consumption_forecasts')
      .select('*')
      .eq('consumer_unit_id', consumerUnitId)
      .order('forecast_month', { ascending: false });
    if (error) throw new BadRequestException(error.message);
    return data;
  }

  async findOne(id: string) {
    const { data, error } = await this.supabaseService
      .getClient()
      .from('consumption_forecasts')
      .select('*')
      .eq('id', id)
      .single();
    if (error) throw new NotFoundException('Forecast not found');
    return data;
  }

  async update(id: string, dto: Partial<ForecastDto>) {
    const { data, error } = await this.supabaseService
      .getClient()
      .from('consumption_forecasts')
      .update(dto)
      .eq('id', id)
      .select()
      .single();
    if (error) throw new BadRequestException(error.message);
    return data;
  }

  async delete(id: string) {
    const { error } = await this.supabaseService
      .getClient()
      .from('consumption_forecasts')
      .delete()
      .eq('id', id);
    if (error) throw new BadRequestException(error.message);
    return { success: true };
  }
}
