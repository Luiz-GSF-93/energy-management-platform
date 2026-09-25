import { Injectable, NotFoundException, ConflictException, InternalServerErrorException, BadRequestException } from '@nestjs/common';
import { SupabaseService } from '../../../services/supabase.service';
import { CreateConsumerUnitDto, UpdateConsumerUnitDto } from '../dto/create-consumer-unit.dto';
import { validateWriteDto } from '../../../common/validation/validate-write-dto';

@Injectable()
export class ConsumerUnitsService {
  constructor(private supabaseService: SupabaseService) {}

  private toRow(dto: CreateConsumerUnitDto | UpdateConsumerUnitDto) {
    const columns = {
      contractedDemandPeak: 'contracted_demand_peak',
      contractedDemandOffPeak: 'contracted_demand_off_peak',
      demandTariff: 'demand_tariff',
      demandTariffPeak: 'demand_tariff_peak',
      demandTariffOffPeak: 'demand_tariff_off_peak',
      energyTariffPeak: 'energy_tariff_peak',
      energyTariffOffPeak: 'energy_tariff_off_peak',
      reactiveEnergyTariff: 'reactive_energy_tariff',
      lastDemandValue: 'last_demand_value',
      lastDemandPeak: 'last_demand_peak',
      lastDemandOffPeak: 'last_demand_off_peak',
      tariffSubgroup: 'tariff_subgroup',
      consumptionClass: 'consumption_class',
      freeMarket: 'free_market',
      lastDemandAdjustmentDate: 'last_demand_adjustment_date',
      customerId: 'customer_id', name: 'name', code: 'consumer_unit_number',
      distributor: 'distributor', tariffGroup: 'tariff_group', tariffModality: 'tariff_modality',
      contractedDemand: 'contracted_demand', address: 'address', city: 'city', state: 'state',
      installedCapacity: 'installed_capacity', voltageClass: 'voltage', status: 'status',
    };
    return Object.fromEntries(Object.entries(dto)
      .filter(([, value]) => value !== undefined)
      .map(([key, value]) => [columns[key as keyof typeof columns], value]));
  }

  private fail(error: { code?: string }) {
    if(error.code==='P3392')throw new ConflictException('O administrador da plataforma precisa vincular esta licença a um plano antes de novos cadastros.');
    if(error.code==='P3391')throw new ConflictException('Limite de unidades atingido. Solicite upgrade do plano ao administrador da plataforma.');
    if(error.code==='P3390')throw new ConflictException('É necessária uma licença ativa para cadastrar unidades.');
    if (error.code === '23505') throw new ConflictException('Consumer unit already exists in this organization');
    if (error.code === '23503') throw new ConflictException('Consumer unit has related records or its customer is unavailable');
    if (['23502', '23514', '22001', '22P02', 'P3281'].includes(error.code || '')) {
      throw new BadRequestException('Dados elétricos inválidos. Confira grupo, subgrupo, demandas e último ajuste.');
    }
    throw new InternalServerErrorException('Unable to access consumer units');
  }

  async findAll(organizationId: string) {
    const { data, error } = await this.supabaseService
      .getClient()
      .from('consumer_units')
      .select('*')
      .eq('organization_id', organizationId);

    if (error) this.fail(error);
    return data;
  }

  async findOne(id: string, organizationId: string) {
    const { data, error } = await this.supabaseService
      .getClient()
      .from('consumer_units')
      .select('*')
      .eq('id', id)
      .eq('organization_id', organizationId)
      .maybeSingle();

    if (error) this.fail(error);
    if (!data) throw new NotFoundException('Consumer unit not found');
    return data;
  }

  async create(
    createConsumerUnitDto: CreateConsumerUnitDto,
    organizationId: string,
    entry: Record<string,unknown> = {},
  ) {
    createConsumerUnitDto = await validateWriteDto(CreateConsumerUnitDto, createConsumerUnitDto);
    // The service-role client bypasses RLS: scope the parent as well as the child.
    const customer = await this.supabaseService.getClient().from('customers')
      .select('id').eq('id', createConsumerUnitDto.customerId)
      .eq('organization_id', organizationId).is('deleted_at', null).maybeSingle();
    if (customer.error) this.fail(customer.error);
    if (!customer.data) throw new NotFoundException('Customer not found');
    const { data, error } = await this.supabaseService
      .getClient()
      .from('consumer_units')
      .insert([{ ...this.toRow(createConsumerUnitDto), ...entry, organization_id: organizationId }])
      .select()
      .single();

    if (error) this.fail(error);
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
      .update(this.toRow(updateConsumerUnitDto))
      .eq('id', id)
      .eq('organization_id', organizationId)
      .select()
      .maybeSingle();

    if (error) this.fail(error);
    if (!data) throw new NotFoundException('Consumer unit not found');
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
      .maybeSingle();

    if (error) this.fail(error);
    if (!data) throw new NotFoundException('Consumer unit not found');
    return data;
  }
}
