import {BadRequestException,ForbiddenException,Injectable,InternalServerErrorException} from '@nestjs/common';
import {ConfigService} from '@nestjs/config';
import {SupabaseService} from '../../services/supabase.service';
import {AccessContext} from '../../common/interfaces/tenant-context.interface';
import {PERMISSIONS} from '../../common/constants/permissions';
import {mapQuery,mapId} from './energy-map.validation';

export function platformMapQuery(value:Record<string,unknown>){
 const {organizationId,location,...rest}=value;
 if(Object.keys(rest).some(k=>!['search','state','market','gd','bess','offset','limit'].includes(k)))throw new BadRequestException('Filtro inválido.');
 const query=mapQuery({...rest,...(location==='NO_UNIT'?{}:{location})});
 return {...query,location:location==='NO_UNIT'?'NO_UNIT':query.location,organizationId:organizationId===undefined||organizationId===''?null:mapId(organizationId)};
}
@Injectable()
export class PlatformEnergyMapService {
 constructor(private db:SupabaseService,private config:ConfigService){}
 async read(input:Record<string,unknown>,context:AccessContext){
  if(context?.scope!=='global'||context.role!=='admin_platform'||!context.userId||!context.permissions?.includes(PERMISSIONS.PLATFORM_ORGANIZATIONS_VIEW))throw new ForbiddenException('Mapa geral exclusivo do administrador da plataforma.');
  if(this.config.get<string>('ENERGY_MAP_PLATFORM_ENABLED')!=='true')throw new ForbiddenException('Mapa geral em implantação.');
  const query=platformMapQuery(input);
  const r=await this.db.getClient().rpc('read_platform_energy_map',{p_actor:context.userId,p_query:query});
  if(r.error?.code==='42501')throw new ForbiddenException('Acesso global indisponível.');
  if(r.error?.code==='22023'||r.error?.code==='22P02')throw new BadRequestException('Revise os filtros.');
  if(r.error||r.data?.scope!=='global'||!Array.isArray(r.data.rows)||r.data.rows.length>query.limit||!Number.isSafeInteger(r.data.total)||r.data.rows.some((row:any)=>typeof row.organizationId!=='string'||!row.organizationId||typeof row.hasUnit!=='boolean'||query.organizationId&&row.organizationId!==query.organizationId))throw new InternalServerErrorException('Não foi possível consultar a carteira da plataforma.');
  return r.data;
 }
}
