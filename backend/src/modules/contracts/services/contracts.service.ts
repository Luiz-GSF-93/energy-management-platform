import { Injectable } from '@nestjs/common';
import { SupabaseService } from '../../../services/supabase.service';
import { CreateContractDto, UpdateContractDto } from '../dto/create-contract.dto';
import { validateWriteDto } from '../../../common/validation/validate-write-dto';
import { LicensesService } from '../../licenses/services/licenses.service';

@Injectable()
export class ContractsService {
  constructor(
    private supabaseService: SupabaseService,
    private licensesService: LicensesService,
  ) {}

  async findAll(organizationId: string) {
    const { data, error } = await this.supabaseService
      .getClient()
      .from('energy_contracts')
      .select('*')
      .eq('organization_id', organizationId);

    if (error) throw new Error(error.message);
    return data;
  }

  async findOne(id: string, organizationId: string) {
    const { data, error } = await this.supabaseService
      .getClient()
      .from('energy_contracts')
      .select('*')
      .eq('id', id)
      .eq('organization_id', organizationId)
      .single();

    if (error) throw new Error(error.message);
    return data;
  }

  async create(createContractDto: CreateContractDto, organizationId: string) {
    await this.licensesService.requireEntitlement(organizationId, 'free_market_management');
    createContractDto = await validateWriteDto(CreateContractDto, createContractDto);
    const { data, error } = await this.supabaseService
      .getClient()
      .from('energy_contracts')
      .insert([{ ...createContractDto, organization_id: organizationId }])
      .select()
      .single();

    if (error) throw new Error(error.message);
    return data;
  }

  async update(
    id: string,
    organizationId: string,
    updateContractDto: UpdateContractDto,
  ) {
    updateContractDto = await validateWriteDto(UpdateContractDto, updateContractDto);
    const { data, error } = await this.supabaseService
      .getClient()
      .from('energy_contracts')
      .update(updateContractDto)
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
      .from('energy_contracts')
      .delete()
      .eq('id', id)
      .eq('organization_id', organizationId)
      .select()
      .single();

    if (error) throw new Error(error.message);
    return data;
  }
}
