import { Injectable, BadRequestException } from '@nestjs/common';
import { SupabaseService } from '../../../services/supabase.service';
import { CreateTariffDto } from '../dto/tariff.dto';

@Injectable()
export class TariffService {
  constructor(private supabaseService: SupabaseService) {}

  async create(createTariffDto: CreateTariffDto) {
    const month = new Date(createTariffDto.month).toISOString().split('T')[0];

    const { data, error } = await this.supabaseService
      .getClient()
      .from('market_tariffs')
      .insert([{ ...createTariffDto, month }])
      .select()
      .single();

    if (error) throw new BadRequestException(error.message);
    return data;
  }

  async findByContract(contractId: string) {
    const { data, error } = await this.supabaseService
      .getClient()
      .from('market_tariffs')
      .select('*')
      .eq('contractId', contractId)
      .order('month', { ascending: false });

    if (error) throw new BadRequestException(error.message);
    return data;
  }

  async getLatestTariffs(contractId: string) {
    const { data, error } = await this.supabaseService
      .getClient()
      .from('market_tariffs')
      .select('*')
      .eq('contractId', contractId)
      .order('month', { ascending: false })
      .limit(12);

    if (error) throw new BadRequestException(error.message);
    return data;
  }
}
