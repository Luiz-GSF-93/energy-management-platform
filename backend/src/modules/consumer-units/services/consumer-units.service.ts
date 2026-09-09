import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { SupabaseService } from '../../../services/supabase.service';
import { CreateConsumerUnitDto, UpdateConsumerUnitDto } from '../dto/create-consumer-unit.dto';

@Injectable()
export class ConsumerUnitsService {
  constructor(private supabaseService: SupabaseService) {}

  async create(createConsumerUnitDto: CreateConsumerUnitDto) {
    const { data, error } = await this.supabaseService
      .getClient()
      .from('consumer_units')
      .insert([createConsumerUnitDto])
      .select()
      .single();

    if (error) throw new BadRequestException(error.message);
    return data;
  }

  async findByCustomer(customerId: string) {
    const { data, error } = await this.supabaseService
      .getClient()
      .from('consumer_units')
      .select('*')
      .eq('customerId', customerId)
      .is('deletedAt', null);

    if (error) throw new BadRequestException(error.message);
    return data;
  }

  async findOne(id: string) {
    const { data, error } = await this.supabaseService
      .getClient()
      .from('consumer_units')
      .select('*')
      .eq('id', id)
      .is('deletedAt', null)
      .single();

    if (error || !data) throw new NotFoundException('Consumer Unit not found');
    return data;
  }

  async update(id: string, updateConsumerUnitDto: UpdateConsumerUnitDto) {
    const { data, error } = await this.supabaseService
      .getClient()
      .from('consumer_units')
      .update(updateConsumerUnitDto)
      .eq('id', id)
      .select()
      .single();

    if (error) throw new BadRequestException(error.message);
    return data;
  }

  async delete(id: string) {
    const { error } = await this.supabaseService
      .getClient()
      .from('consumer_units')
      .update({ deletedAt: new Date().toISOString() })
      .eq('id', id);

    if (error) throw new BadRequestException(error.message);
    return { message: 'Consumer Unit deleted successfully' };
  }
}
