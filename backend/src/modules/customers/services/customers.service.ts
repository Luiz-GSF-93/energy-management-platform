import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { SupabaseService } from '../../../services/supabase.service';
import { CreateCustomerDto, UpdateCustomerDto } from '../dto/create-customer.dto';

@Injectable()
export class CustomersService {
  constructor(private supabaseService: SupabaseService) {}

  async create(createCustomerDto: CreateCustomerDto) {
    const { data, error } = await this.supabaseService
      .getClient()
      .from('customers')
      .insert([createCustomerDto])
      .select()
      .single();

    if (error) throw new BadRequestException(error.message);
    return data;
  }

  async findAll(organizationId: string) {
    const { data, error } = await this.supabaseService
      .getClient()
      .from('customers')
      .select('*')
      .eq('organizationId', organizationId)
      .is('deletedAt', null);

    if (error) throw new BadRequestException(error.message);
    return data;
  }

  async findOne(id: string, organizationId: string) {
    const { data, error } = await this.supabaseService
      .getClient()
      .from('customers')
      .select('*')
      .eq('id', id)
      .eq('organizationId', organizationId)
      .is('deletedAt', null)
      .single();

    if (error || !data) throw new NotFoundException('Customer not found');
    return data;
  }

  async update(id: string, organizationId: string, updateCustomerDto: UpdateCustomerDto) {
    const { data, error } = await this.supabaseService
      .getClient()
      .from('customers')
      .update(updateCustomerDto)
      .eq('id', id)
      .eq('organizationId', organizationId)
      .select()
      .single();

    if (error) throw new BadRequestException(error.message);
    return data;
  }

  async delete(id: string, organizationId: string) {
    const { error } = await this.supabaseService
      .getClient()
      .from('customers')
      .update({ deletedAt: new Date().toISOString() })
      .eq('id', id)
      .eq('organizationId', organizationId);

    if (error) throw new BadRequestException(error.message);
    return { message: 'Customer deleted successfully' };
  }
}
