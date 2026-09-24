import { Injectable } from '@nestjs/common';
import { SupabaseService } from '../../../services/supabase.service';
import { CreateConsumerUnitDto, UpdateConsumerUnitDto } from '../dto/create-consumer-unit.dto';
import { validateWriteDto } from '../../../common/validation/validate-write-dto';

@Injectable()
export class ConsumerUnitsService {
  constructor(private supabaseService: SupabaseService) {}

  async findAll(organizationId: string) {
    const { data, error } = await this.supabaseService
      .getClient()
      .from('consumer_units')
      .select('*')
      .eq('organization_id', organizationId);

    if (error) throw new Error(error.message);
    return data;
  }

  async findOne(id: string, organizationId: string) {
    const { data, error } = await this.supabaseService
      .getClient()
      .from('consumer_units')
      .select('*')
      .eq('id', id)
      .eq('organization_id', organizationId)
      .single();

    if (error) throw new Error(error.message);
    return data;
  }

  async create(
    createConsumerUnitDto: CreateConsumerUnitDto,
    organizationId: string,
  ) {
    createConsumerUnitDto = await validateWriteDto(CreateConsumerUnitDto, createConsumerUnitDto);
    const { data, error } = await this.supabaseService
      .getClient()
      .from('consumer_units')
      .insert([{ ...createConsumerUnitDto, organization_id: organizationId }])
      .select()
      .single();

    if (error) throw new Error(error.message);
    return data;
  }

  async update(
    id: string,
    organizationId: string,
    updateConsumerUnitDto: UpdateConsumerUnitDto,
  ) {
    updateConsumerUnitDto = await validateWriteDto(UpdateConsumerUnitDto, updateConsumerUnitDto);
    const { data, error } = await this.supabaseService
      .getClient()
      .from('consumer_units')
      .update(updateConsumerUnitDto)
      .eq('id', id)
      .eq('organization_id', organizationId)
      .select()
      .single();

    if (error) throw new Error(error.message);
    return data;
  }

  async delete(id: string, organizationId: string) {
    const { data, error } = await this.supabaseService
      .getClient()
      .from('consumer_units')
      .delete()
      .eq('id', id)
      .eq('organization_id', organizationId)
      .select()
      .single();

    if (error) throw new Error(error.message);
    return data;
  }
}
