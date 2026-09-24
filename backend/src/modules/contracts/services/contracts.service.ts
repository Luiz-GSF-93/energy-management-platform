import { Injectable, BadRequestException, ConflictException, InternalServerErrorException, NotFoundException } from '@nestjs/common';
import { SupabaseService } from '../../../services/supabase.service';
import { CreateContractDto, UpdateContractDto } from '../dto/create-contract.dto';
import { validateWriteDto } from '../../../common/validation/validate-write-dto';
import { LicensesService } from '../../licenses/services/licenses.service';

const columns: Record<string, string> = {
  contractNumber: 'contract_number', contractType: 'contract_type',
  contractedVolumeMwh: 'contracted_volume_mwh', currentPrice: 'current_price',
  startDate: 'start_date', endDate: 'end_date', energyType: 'energy_type',
  supplierId: 'supplier_id', energySource: 'energy_source',
  adjustmentIndex: 'adjustment_index', adjustmentFrequency: 'adjustment_frequency',
  adjustmentDate: 'adjustment_date', managementContractId: 'management_contract_id',
  status: 'status', notes: 'notes',
};

@Injectable()
export class ContractsService {
  constructor(private supabaseService: SupabaseService, private licensesService: LicensesService) {}
  private table(name = 'energy_contracts') { return this.supabaseService.getClient().from(name); }
  private check(error: any) {
    if (!error) return;
    if (error.code === '23505') throw new ConflictException('Contract number already exists');
    throw new InternalServerErrorException('Unable to access contracts');
  }
  private mapped(dto: object) {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(dto)) {
      if (columns[key] && value !== undefined) result[columns[key]] = value;
    }
    return result;
  }
  private dates(start: string, end: string) {
    // Calendar dates avoid timezone shifts in timestamp-without-time-zone columns.
    if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end) || end < start) {
      throw new BadRequestException('Use YYYY-MM-DD dates with endDate on or after startDate');
    }
  }
  async findAll(organizationId: string) {
    const { data, error } = await this.table().select('*').eq('organization_id', organizationId);
    this.check(error);
    return data;
  }
  async findOne(id: string, organizationId: string) {
    const { data, error } = await this.table().select('*').eq('id', id).eq('organization_id', organizationId).maybeSingle();
    this.check(error);
    if (!data) throw new NotFoundException('Contract not found');
    return data;
  }
  async create(input: CreateContractDto, organizationId: string) {
    await this.licensesService.requireEntitlement(organizationId, 'free_market_management');
    const dto = await validateWriteDto(CreateContractDto, input);
    this.dates(dto.startDate, dto.endDate);
    if (dto.adjustmentDate && !/^\d{4}-\d{2}-\d{2}$/.test(dto.adjustmentDate)) throw new BadRequestException('Use YYYY-MM-DD for adjustmentDate');
    const unit = await this.table('consumer_units').select('id,customer_id').eq('id', dto.consumerUnitId).eq('organization_id', organizationId).maybeSingle();
    this.check(unit.error);
    if (!unit.data) throw new NotFoundException('Consumer unit not found');
    const customer = await this.table('customers').select('id').eq('id', unit.data.customer_id).eq('organization_id', organizationId).is('deleted_at', null).maybeSingle();
    this.check(customer.error);
    if (!customer.data) throw new NotFoundException('Customer not found');
    if (dto.managementContractId) {
      const management = await this.table('management_contracts').select('id').eq('id', dto.managementContractId).eq('organization_id', organizationId).eq('customer_id', customer.data.id).maybeSingle();
      this.check(management.error);
      if (!management.data) throw new NotFoundException('Management contract not found for this customer');
    }
    const { data, error } = await this.table().insert([{
      ...this.mapped(dto), organization_id: organizationId, customer_id: customer.data.id,
      consumer_unit_id: unit.data.id, status: dto.status ?? 'DRAFT',
    }]).select().single();
    this.check(error);
    return data;
  }
  async update(id: string, organizationId: string, input: UpdateContractDto) {
    const dto = await validateWriteDto(UpdateContractDto, input);
    const current = await this.findOne(id, organizationId);
    if (current.status !== 'DRAFT') throw new ConflictException('Historical contracts cannot be overwritten; an amendment is required');
    if (dto.endDate) this.dates(String(current.start_date).slice(0, 10), dto.endDate);
    const { data, error } = await this.table().update(this.mapped(dto)).eq('id', id).eq('organization_id', organizationId).eq('status', 'DRAFT').select().maybeSingle();
    this.check(error);
    if (!data) throw new ConflictException('Contract changed; reload before editing');
    return data;
  }
  async delete(id: string, organizationId: string) {
    const current = await this.findOne(id, organizationId);
    if (current.status !== 'DRAFT') throw new ConflictException('Historical contracts cannot be deleted');
    const { data, error } = await this.table().delete().eq('id', id).eq('organization_id', organizationId).eq('status', 'DRAFT').select().maybeSingle();
    this.check(error);
    if (!data) throw new ConflictException('Contract changed; reload before deleting');
    return data;
  }
}
