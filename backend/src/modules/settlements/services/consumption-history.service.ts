import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { SupabaseService } from '../../../services/supabase.service';
import { ConsumptionHistoryDto } from '../dto/consumption-history.dto';

@Injectable()
export class ConsumptionHistoryService {
  constructor(private supabaseService: SupabaseService) {}

  async create(dto: ConsumptionHistoryDto) {
    const { data, error } = await this.supabaseService
      .getClient()
      .from('monthly_consumption_history')
      .insert([dto])
      .select();
    if (error) throw new BadRequestException(error.message);
    return data?.[0];
  }

  async findByConsumerUnit(consumerUnitId: string) {
    const { data, error } = await this.supabaseService
      .getClient()
      .from('monthly_consumption_history')
      .select('*')
      .eq('consumer_unit_id', consumerUnitId)
      .is('deleted_at', null)
      .order('month', { ascending: false });
    if (error) throw new BadRequestException(error.message);
    return data;
  }

  async getTrend(consumerUnitId: string, months: number = 12) {
    const { data, error } = await this.supabaseService
      .getClient()
      .from('monthly_consumption_history')
      .select('month, consumption_kwh')
      .eq('consumer_unit_id', consumerUnitId)
      .is('deleted_at', null)
      .order('month', { ascending: true })
      .limit(months);
    if (error) throw new BadRequestException(error.message);
    
    const dataArray = data || [];
    const average = dataArray.length > 0
      ? dataArray.reduce((sum: number, r: any) => sum + (r.consumption_kwh || 0), 0) / dataArray.length
      : 0;
    
    return { trend: dataArray, average };
  }

  async findOne(id: string) {
    const { data, error } = await this.supabaseService
      .getClient()
      .from('monthly_consumption_history')
      .select('*')
      .eq('id', id)
      .is('deleted_at', null)
      .single();
    if (error) throw new NotFoundException('Consumption history not found');
    return data;
  }

  async update(id: string, dto: Partial<ConsumptionHistoryDto>) {
    const { data, error } = await this.supabaseService
      .getClient()
      .from('monthly_consumption_history')
      .update(dto)
      .eq('id', id)
      .select()
      .single();
    if (error) throw new BadRequestException(error.message);
    return data;
  }

  async delete(id: string) {
    const { data, error } = await this.supabaseService
      .getClient()
      .from('monthly_consumption_history')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', id)
      .select()
      .single();
    if (error) throw new BadRequestException(error.message);
    return data;
  }
}
