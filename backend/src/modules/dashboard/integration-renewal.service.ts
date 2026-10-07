import {BadRequestException,ConflictException,Injectable,ServiceUnavailableException} from '@nestjs/common';
import {SupabaseService} from '../../services/supabase.service';
import {IntegrationRenewalDto} from './integration-renewal.dto';
import {renewalStatus,validateRenewal} from './integration-renewal';
@Injectable()
export class IntegrationRenewalService {
 constructor(private readonly db:SupabaseService){}
 async get(){
  const {data,error}=await this.db.getClient().from('platform_whatsapp_renewal').select('revision,issued_on,expires_on,no_expiry,reminder_days,updated_at').eq('id',true).single();
  if(error||!data)throw new ServiceUnavailableException('Não foi possível consultar a validade da integração.');
  return renewalStatus(data);
 }
 async save(dto:IntegrationRenewalDto,actor:string){
  validateRenewal(dto);
  const {data,error}=await this.db.getClient().rpc('save_platform_whatsapp_renewal',{p_definition:dto,p_actor:actor});
  if(error?.code==='P3151')throw new ConflictException('Outro administrador alterou a validade. Atualize antes de salvar.');
  if(error?.code==='22023'||error?.code==='23514')throw new BadRequestException('Confira as datas e a antecedência.');
  if(error||!data)throw new ServiceUnavailableException('Registro de validade não confirmado.');
  return renewalStatus(data);
 }
}
