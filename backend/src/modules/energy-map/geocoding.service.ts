import {BadRequestException,ConflictException,ForbiddenException,Injectable,InternalServerErrorException,NotFoundException,ServiceUnavailableException} from '@nestjs/common';
import {ConfigService} from '@nestjs/config';
import {SupabaseService} from '../../services/supabase.service';
import {TenantContext} from '../../common/interfaces/tenant-context.interface';
import {EnergyMapService} from './energy-map.service';
import {MapboxGeocodingProvider,GeocodeFailure,geocodeAddress} from './geocoding.provider';
import {MAP_MANAGE,mapId} from './energy-map.validation';

@Injectable()
export class EnergyMapGeocodingService {
 constructor(private maps:EnergyMapService,private db:SupabaseService,private config:ConfigService,private provider:MapboxGeocodingProvider){}
 private configured(org:string){return (this.config.get<string>('ENERGY_MAP_GEOCODING_ORGANIZATIONS')||'').split(',').map(v=>v.trim()).includes(org)&&this.provider.configured();}
 private async access(t:TenantContext,write=false){const a=await this.maps.access(t);if(!a.enabled||write&&!t.permissions.includes(MAP_MANAGE))throw new ForbiddenException('Localização exige acesso autorizado.');return a;}
 private fail(e:any){if(!e)return;if(e.code==='42501')throw new ForbiddenException('Vínculo ou permissão indisponível.');if(e.code==='P3161')throw new ConflictException('Endereço ou localização mudou. Atualize a unidade.');if(e.code==='P3162')throw new NotFoundException('Unidade indisponível.');if(e.code==='P3163')throw new ServiceUnavailableException('Limite de consultas atingido.');if(['22023','22P02','23514'].includes(e.code))throw new BadRequestException('Revise os dados da unidade.');throw new InternalServerErrorException('Não foi possível consultar a localização.');}
 private async rpc(name:string,args:Record<string,unknown>){const r=await this.db.getClient().rpc(name,args);this.fail(r.error);return r.data;}
 async read(id:string,t:TenantContext){await this.access(t);mapId(id);const job=await this.rpc('read_energy_map_geocoding',{p_org:t.organizationId,p_actor:t.userId,p_unit:id});return {organizationId:t.organizationId,unitId:id,enabled:this.configured(t.organizationId),job};}
 async locate(id:string,input:unknown,t:TenantContext){await this.access(t,true);mapId(id);
  if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).length!==1||typeof (input as any).addressHash!=='string'||!/^[a-f0-9]{32}$/.test((input as any).addressHash))throw new BadRequestException('Atualize o endereço da unidade.');
  if(!this.configured(t.organizationId))throw new ServiceUnavailableException('Consulta automática ainda não configurada.');
  const claim=await this.rpc('claim_energy_map_geocoding',{p_org:t.organizationId,p_actor:t.userId,p_unit:id,p_hash:(input as any).addressHash,p_daily:10,p_monthly:100});
  if(claim.dispatch){let candidates:any[]=[],error:string|null=null;
   try{geocodeAddress(claim.address);candidates=await this.provider.locate(claim.address);}catch(e){error=e instanceof GeocodeFailure?e.code:'PROVIDER_UNAVAILABLE';}
   await this.rpc('finish_energy_map_geocoding',{p_org:t.organizationId,p_actor:t.userId,p_job:claim.jobId,p_lease:claim.leaseId,p_candidates:candidates,p_error:error});
  }
  return this.read(id,t);
 }
 async confirm(id:string,input:unknown,t:TenantContext){await this.access(t,true);mapId(id);
  if(!input||typeof input!=='object'||Array.isArray(input))throw new BadRequestException('Confirmação inválida.');const b=input as Record<string,any>;
  if(Object.keys(b).length!==7||Object.keys(b).some(k=>!['jobId','index','reason','revision','requestId','checkedAddress','addressHash'].includes(k))||!Number.isInteger(b.index)||b.index<0||b.index>4)throw new BadRequestException('Confirmação inválida.');
  mapId(b.jobId);if(typeof b.reason!=='string'||b.reason.trim().length<3||b.reason.length>490||!Number.isSafeInteger(b.revision)||b.revision<0||b.checkedAddress!==true||typeof b.requestId!=='string'||!/^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(b.requestId)||typeof b.addressHash!=='string'||!/^[a-f0-9]{32}$/.test(b.addressHash))throw new BadRequestException('Confira o endereço e a justificativa.');const data={reason:b.reason.trim(),revision:b.revision,requestId:b.requestId,checkedAddress:true,addressHash:b.addressHash};
  return this.rpc('confirm_energy_map_geocoding',{p_org:t.organizationId,p_actor:t.userId,p_unit:id,p_job:b.jobId,p_index:b.index,p_data:data});
 }
}
