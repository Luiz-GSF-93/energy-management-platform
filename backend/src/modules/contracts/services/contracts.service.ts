import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { SupabaseService } from '../../../services/supabase.service';
import { CreateContractDto, UpdateContractDto } from '../dto/create-contract.dto';

@Injectable()
export class ContractsService {
  constructor(private supabaseService: SupabaseService) {}

  async create(createContractDto: CreateContractDto) {
    const { data, error } = await this.supabaseService
      .getClient()
      .from('energy_contracts')
      .insert([{ ...createContractDto, status: 'ACTIVE' }])
      .select()
      .single();

    if (error) throw new BadRequestException(error.message);
    return data;
  }

  async findByConsumerUnit(consumerUnitId: string) {
    const { data, error } = await this.supabaseService
      .getClient()
      .from('energy_contracts')
      .select('*')
      .eq('consumerUnitId', consumerUnitId)
      .is('deletedAt', null);

    if (error) throw new BadRequestException(error.message);
    return data;
  }

  async findOne(id: string) {
    const { data, error } = await this.supabaseService
      .getClient()
      .from('energy_contracts')
      .select('*')
      .eq('id', id)
      .is('deletedAt', null)
      .single();

    if (error || !data) throw new NotFoundException('Contract not found');
    return data;
  }

  async update(id: string, updateContractDto: UpdateContractDto) {
    const { data, error } = await this.supabaseService
      .getClient()
      .from('energy_contracts')
      .update(updateContractDto)
      .eq('id', id)
      .select()
      .single();

    if (error) throw new BadRequestException(error.message);
    return data;
  }

  async delete(id: string) {
    const { error } = await this.supabaseService
      .getClient()
      .from('energy_contracts')
      .update({ deletedAt: new Date().toISOString() })
      .eq('id', id);

    if (error) throw new BadRequestException(error.message);
    return { message: 'Contract deleted successfully' };
  }
}
