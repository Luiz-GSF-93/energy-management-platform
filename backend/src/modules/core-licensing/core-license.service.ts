import {BadRequestException,ConflictException,ForbiddenException,Injectable,ServiceUnavailableException} from '@nestjs/common';
import {ConfigService} from '@nestjs/config';
import {timingSafeEqual} from 'node:crypto';
import {SupabaseService} from '../../services/supabase.service';
import {coreLicenseInput} from './core-license-contract';
import {invalidateCoreSubscription} from '../../common/services/core-subscription-access';

@Injectable()
export class CoreLicenseService{
 constructor(private db:SupabaseService,private config:ConfigService){}
 authorize(authorization:unknown){
  if(this.config.get('SALES_CORE_LICENSES_ENABLED')!=='true')throw new ServiceUnavailableException('Integração de licenças Core ainda não habilitada.');
  const secret=this.config.get<string>('SALES_CORE_LICENSE_TOKEN'),actor=this.config.get<string>('SALES_CORE_LICENSE_ACTOR_ID');
  if(!secret||!/^\S{43,255}$/.test(secret)||[this.config.get('SUPABASE_SERVICE_KEY'),this.config.get('SALES_CORE_BRIDGE_TOKEN'),this.config.get('RESEND_API_KEY')].includes(secret)||!actor||!/^[a-f0-9-]{36}$/i.test(actor))throw new ServiceUnavailableException('Credencial exclusiva e responsável da integração não configurados.');
  if(typeof authorization!=='string'||authorization.length>262)throw new ForbiddenException('Integração não autorizada.');
  const expected=Buffer.from('Bearer '+secret),received=Buffer.from(authorization);if(expected.length!==received.length||!timingSafeEqual(expected,received))throw new ForbiddenException('Integração não autorizada.');return actor;
 }
 async rpc(name:string,body:Record<string,unknown>){
  let r:any;try{r=await this.db.getClient().rpc(name,body);}catch{throw new ServiceUnavailableException('Resposta não confirmada. Consulte o mesmo protocolo antes de repetir.');}
  if(r.error){if(r.error.code==='42501')throw new ForbiddenException('Fonte ou responsável não autorizado para esta licença.');if(r.error.code==='P3660'||r.error.code==='23505')throw new ConflictException('A versão, a conferência ou o contrato mudou. Reconcilie a fonte antes de tentar novamente.');if(['22023','23514','22P02','22007','22008'].includes(r.error.code))throw new BadRequestException('Confira a evidência, os limites e as datas da licença.');throw new ServiceUnavailableException('Não foi possível confirmar a integração. Preserve o protocolo.');}return r.data;
 }
 async sync(token:unknown,raw:unknown){const actor=this.authorize(token),body=coreLicenseInput(raw),r=await this.rpc('platform_core_license_sync',{p_actor:actor,p_body:body});if(!r||typeof r.organizationId!=='string'||typeof r.licenseId!=='string')throw new ServiceUnavailableException('Resultado da licença não confirmado.');invalidateCoreSubscription(r.organizationId);return r;}
 async status(token:unknown,raw:unknown){const actor=this.authorize(token);if(!raw||typeof raw!=='object'||Array.isArray(raw)||Object.keys(raw).length!==1||!('subscriptions'in raw)||!Array.isArray(raw.subscriptions)||raw.subscriptions.length>50||raw.subscriptions.some(id=>typeof id!=='string'||!/^[a-f0-9-]{36}$/i.test(id)))throw new BadRequestException('Consulta de assinaturas inválida.');return this.rpc('platform_core_license_status',{p_actor:actor,p_ids:raw.subscriptions});}
}
