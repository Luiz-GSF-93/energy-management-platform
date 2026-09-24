import { Injectable } from '@nestjs/common';
import { SupabaseService } from '../../../services/supabase.service';
import { CreateCustomerDto, UpdateCustomerDto } from '../dto/create-customer.dto';
import { validateWriteDto } from '../../../common/validation/validate-write-dto';

@Injectable()
export class CustomersService {
  constructor(private supabaseService: SupabaseService) {}

  async findAll(organizationId: string) {
    const { data, error } = await this.supabaseService
      .getClient()
      .from('customers')
      .select('*')
      .eq('organization_id', organizationId);

    if (error) throw new Error(error.message);
    return data;
  }

  async findOne(id: string, organizationId: string) {
    const { data, error } = await this.supabaseService
      .getClient()
      .from('customers')
      .select('*')
      .eq('id', id)
      .eq('organization_id', organizationId)
      .single();

    if (error) throw new Error(error.message);
    return data;
  }

  async create(createCustomerDto: CreateCustomerDto, organizationId: string) {
    createCustomerDto = await validateWriteDto(CreateCustomerDto, createCustomerDto);
    const { data, error } = await this.supabaseService
      .getClient()
      .from('customers')
      .insert([{ ...createCustomerDto, organization_id: organizationId }])
      .select()
      .single();

    if (error) throw new Error(error.message);
    return data;
  }

  async update(
    id: string,
    organizationId: string,
    updateCustomerDto: UpdateCustomerDto,
  ) {
    updateCustomerDto = await validateWriteDto(UpdateCustomerDto, updateCustomerDto);
    const { data, error } = await this.supabaseService
      .getClient()
      .from('customers')
      .update(updateCustomerDto)
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
      .from('customers')
      .delete()
      .eq('id', id)
      .eq('organization_id', organizationId)
      .select()
      .single();

    if (error) throw new Error(error.message);
    return data;
  }
}
