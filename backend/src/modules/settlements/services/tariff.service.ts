import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { SupabaseService } from '../../../services/supabase.service';
import { TariffDto } from '../dto/tariff.dto';

@Injectable()
export class TariffService {
  constructor(private supabaseService: SupabaseService) {}

  async create(dto: TariffDto) {
    const { data, error } = await this.supabaseService
      .getClient()
      .from('market_tariffs')
      .insert([dto])
      .select();
    if (error) throw new BadRequestException(error.message);
    return data?.[0];
  }

  async getLatestByContract(contractId: string) {
    const { data, error } = await this.supabaseService
      .getClient()
      .from('market_tariffs')
      .select('*')
      .eq('energy_contract_id', contractId)
      .order('month', { ascending: false })
      .limit(1)
      .single();
    if (error) throw new NotFoundException('Tariff not found');
    return data;
  }

  async findAll() {
    const { data, error } = await this.supabaseService
      .getClient()
      .from('market_tariffs')
      .select('*')
      .order('month', { ascending: false });
    if (error) throw new BadRequestException(error.message);
    return data;
  }

  async findOne(id: string) {
    const { data, error } = await this.supabaseService
      .getClient()
      .from('market_tariffs')
      .select('*')
      .eq('id', id)
      .single();
    if (error) throw new NotFoundException('Tariff not found');
    return data;
  }

  async update(id: string, dto: Partial<TariffDto>) {
    const { data, error } = await this.supabaseService
      .getClient()
      .from('market_tariffs')
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
      .from('market_tariffs')
      .delete()
      .eq('id', id);
    if (error) throw new BadRequestException(error.message);
    return { success: true };
  }
}
