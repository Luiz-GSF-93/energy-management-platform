import {editEnvelope,saveRegistration,registrationHistory} from '../../../common/registration-edit';
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
      const result=await fetch('https://minhareceita.org/'+cnpj,{signal:AbortSignal.timeout(8000),redirect:'error'});
      if(result.status===404)throw new NotFoundException('CNPJ não encontrado na base consultada. Confira ou preencha manualmente.');
      if(!result.ok)throw new Error('Provider unavailable');
      const data:any=await result.json();
      if(normalizeTaxId(String(data.cnpj))!==cnpj||typeof data.razao_social!=='string')throw new Error('Invalid provider response');
      return {cnpj,company_name:data.razao_social.slice(0,200),trade_name:typeof data.nome_fantasia==='string'?data.nome_fantasia.slice(0,200):'',registration_status:typeof data.descricao_situacao_cadastral==='string'?data.descricao_situacao_cadastral:'Não informada',source:'Minha Receita'};
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

  async history(id:string,organizationId:string){return registrationHistory(this.supabaseService.getClient(),organizationId,'customers',id);}
  async exclusiveUsers(id:string,organizationId:string){
    await this.findOne(id,organizationId);
    const {data,error}=await this.supabaseService.getClient().from('organization_members').select('user_id').eq('organization_id',organizationId).eq('exclusive_customer_id',id);
    if(error)throw new ServiceUnavailableException('Vínculos indisponíveis.');return (data||[]).map((x:{user_id:string})=>String(x.user_id)).sort();
  }
  async update(id:string,organizationId:string,input:any,actor:string){
    const body=editEnvelope(input,actor),changes={...body.changes};
    const allowed=["company_name","trade_name","document","contact_name","contact_email","contact_phone","economic_group","status","exclusive_user_ids"];
    if(Object.keys(changes).some(k=>!allowed.includes(k)))throw new BadRequestException('Campo não editável.');
    for(const [key,value] of Object.entries(changes)){
      if(key==='exclusive_user_ids')continue;
      if(value!==null&&(typeof value!=='string'||value.length>(key==='contact_phone'?20:255)))throw new BadRequestException('Campo inválido: '+key);
      if(typeof value==='string')changes[key]=value.trim();
    }
    if('company_name' in changes&&!changes.company_name)throw new BadRequestException('Razão social obrigatória.');
    if('document' in changes){if(typeof changes.document!=='string'||!validTaxId(changes.document))throw new BadRequestException('CPF ou CNPJ inválido.');changes.document=normalizeTaxId(changes.document);}
    if('contact_email' in changes&&changes.contact_email&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(changes.contact_email))throw new BadRequestException('E-mail inválido.');
    if('status' in changes&&!['ACTIVE','INACTIVE'].includes(changes.status))throw new BadRequestException('Selecione ativo ou inativo.');
    if('exclusive_user_ids' in changes){if(!Array.isArray(changes.exclusive_user_ids)||changes.exclusive_user_ids.length>500||changes.exclusive_user_ids.some((x:any)=>typeof x!=='string'||! /^[0-9a-f-]{36}$/i.test(x)))throw new BadRequestException('Usuários inválidos.');changes.exclusive_user_ids=[...new Set(changes.exclusive_user_ids)].sort();}
    return saveRegistration(this.supabaseService.getClient(),organizationId,'customers',id,actor,body,changes);
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
