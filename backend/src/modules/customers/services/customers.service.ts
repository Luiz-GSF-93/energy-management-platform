import { Injectable, BadRequestException, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import {normalizeTaxId,validTaxId} from '../../../common/validation/tax-id';
import { SupabaseService } from '../../../services/supabase.service';
import { CreateCustomerDto, UpdateCustomerDto } from '../dto/create-customer.dto';
import { validateWriteDto } from '../../../common/validation/validate-write-dto';

@Injectable()
export class CustomersService {
  constructor(private supabaseService: SupabaseService) {}

  async lookupCnpj(input:string) {
    const cnpj=normalizeTaxId(input);
    if(cnpj.length!==14||!validTaxId(cnpj))throw new BadRequestException('CNPJ inválido. Confira os dígitos verificadores.');
    if(!/^\d{14}$/.test(cnpj))throw new ServiceUnavailableException('Consulta automática ainda indisponível para CNPJ alfanumérico. Preencha os dados manualmente.');
    try {
      const result=await fetch('https://brasilapi.com.br/api/cnpj/v1/'+cnpj,{signal:AbortSignal.timeout(8000),redirect:'error'});
      if(result.status===404)throw new NotFoundException('CNPJ não encontrado na base consultada. Confira ou preencha manualmente.');
      if(!result.ok)throw new Error('Provider unavailable');
      const data:any=await result.json();
      if(normalizeTaxId(String(data.cnpj))!==cnpj||typeof data.razao_social!=='string')throw new Error('Invalid provider response');
      return {cnpj,company_name:data.razao_social.slice(0,200),trade_name:typeof data.nome_fantasia==='string'?data.nome_fantasia.slice(0,200):'',registration_status:typeof data.descricao_situacao_cadastral==='string'?data.descricao_situacao_cadastral:'Não informada',source:'BrasilAPI / Minha Receita'};
    }catch(e){if(e instanceof NotFoundException)throw e;throw new ServiceUnavailableException('Consulta indisponível. O número foi validado; preencha os dados manualmente ou tente novamente.');}
  }

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
    if(!validTaxId(createCustomerDto.document))throw new BadRequestException('CPF ou CNPJ inválido. Confira os dígitos verificadores.');
    createCustomerDto.document=normalizeTaxId(createCustomerDto.document);
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
