import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { SupabaseService } from '../../../services/supabase.service';
import { CreateSettlementDto } from '../dto/create-settlement.dto';

@Injectable()
export class SettlementService {
  constructor(private supabaseService: SupabaseService) {}

  async create(dto: CreateSettlementDto) {
    const { data, error } = await this.supabaseService
      .getClient()
      .from('monthly_energy_settlements')
      .insert([
        {
          energy_contract_id: dto.energy_contract_id,
          consumer_unit_id: dto.consumer_unit_id,
          month: dto.month,
          consumption_kwh: dto.consumption_kwh,
          gross_savings: dto.gross_savings,
          deductions: dto.deductions,
          net_savings: (dto.gross_savings || 0) - (dto.deductions || 0),
          honorarie: dto.honorarie,
          status: 'DRAFT',
        },
      ])
      .select();
    if (error) throw new BadRequestException(error.message);
    return data?.[0];
  }

  async findByConsumerUnit(consumerUnitId: string) {
    const { data, error } = await this.supabaseService
      .getClient()
      .from('monthly_energy_settlements')
      .select('*')
      .eq('consumer_unit_id', consumerUnitId)
      .is('deleted_at', null);
    if (error) throw new BadRequestException(error.message);
    return data;
  }

  async findOne(id: string) {
    const { data, error } = await this.supabaseService
      .getClient()
      .from('monthly_energy_settlements')
      .select('*')
      .eq('id', id)
      .is('deleted_at', null)
      .single();
    if (error) throw new NotFoundException('Settlement not found');
    return data;
  }

  async update(id: string, dto: Partial<CreateSettlementDto>) {
    const { data, error } = await this.supabaseService
      .getClient()
      .from('monthly_energy_settlements')
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
      .from('monthly_energy_settlements')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', id)
      .select()
      .single();
    if (error) throw new BadRequestException(error.message);
    return data;
  }
}
