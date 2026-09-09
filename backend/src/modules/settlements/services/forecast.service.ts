import { Injectable, BadRequestException } from '@nestjs/common';
import { SupabaseService } from '../../../services/supabase.service';
import { CreateForecastDto } from '../dto/forecast.dto';

@Injectable()
export class ForecastService {
  constructor(private supabaseService: SupabaseService) {}

  async create(createForecastDto: CreateForecastDto) {
    const forecastMonth = new Date(createForecastDto.forecastMonth).toISOString().split('T')[0];

    const { data, error } = await this.supabaseService
      .getClient()
      .from('consumption_forecasts')
      .insert([{ ...createForecastDto, forecastMonth }])
      .select()
      .single();

    if (error) throw new BadRequestException(error.message);
    return data;
  }

  async findByConsumerUnit(consumerUnitId: string) {
    const { data, error } = await this.supabaseService
      .getClient()
      .from('consumption_forecasts')
      .select('*')
      .eq('consumerUnitId', consumerUnitId)
      .order('forecastMonth', { ascending: false });

    if (error) throw new BadRequestException(error.message);
    return data;
  }

  async generateForecast(consumerUnitId: string) {
    // Buscar histórico de 12-24 meses
    const { data: history, error: historyError } = await this.supabaseService
      .getClient()
      .from('monthly_consumption_history')
      .select('month, consumptionKwh')
      .eq('consumerUnitId', consumerUnitId)
      .is('deletedAt', null)
      .order('month', { ascending: false })
      .limit(24);

    if (historyError) throw new BadRequestException(historyError.message);

    if (!history || history.length < 3) {
      throw new BadRequestException('Insufficient historical data for forecasting');
    }

    // Calcular média móvel simples (12 meses)
    const values = (history as any[]).map(h => h.consumptionKwh).reverse();
    const avg = values.reduce((a, b) => a + b, 0) / values.length;

    // Cenários simples
    const baseScenario = avg;
    const optimisticScenario = avg * 0.9; // 10% reduction
    const pessimisticScenario = avg * 1.1; // 10% increase

    // Próximo mês
    const nextMonth = new Date();
    nextMonth.setMonth(nextMonth.getMonth() + 1);

    const forecast = await this.create({
      consumerUnitId,
      forecastMonth: nextMonth,
      baseScenario,
      optimisticScenario,
      pessimisticScenario,
      confidenceLevel: 0.75,
    });

    return forecast;
  }
}
