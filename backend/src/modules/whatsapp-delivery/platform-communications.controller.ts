import {BadRequestException,Controller,ForbiddenException,Get,Query,Req,ServiceUnavailableException} from '@nestjs/common';
import {PlatformScope} from '../../common/decorators/platform-scope.decorator';
import {RequirePermission} from '../../common/decorators/require-permission.decorator';
import {RequestWithAuthenticatedUser} from '../../common/interfaces/authenticated-user.interface';
import {SupabaseService} from '../../services/supabase.service';
import {TEAM_MANAGE,PLATFORM_SUPPORT_VIEW} from '../platform-team/platform-team.permissions';
const allowed=['start','end','page','organization','flow','processing','delivery','association','receipt'];
export function communicationFilters(query:Record<string,unknown>){
 if(Object.entries(query).some(([k,v])=>!allowed.includes(k)||typeof v!=='string'||v.length>510))throw new BadRequestException('Filtros inválidos.');
 const today=new Date().toISOString().slice(0,10);
 const filter:Record<string,string>={start:today.slice(0,7)+'-01',end:today,page:'0'};
 for(const [key,value] of Object.entries(query))if(value!=='')filter[key]=value as string;
 for(const key of ['start','end'])if(!/^\d{4}-\d{2}-\d{2}$/.test(filter[key])||!Number.isFinite(Date.parse(filter[key]))||new Date(filter[key]).toISOString().slice(0,10)!==filter[key])throw new BadRequestException('Informe datas válidas.');
 const days=(Date.parse(filter.end)-Date.parse(filter.start))/86400000;
 if(days<0||days>365||!/^\d{1,4}$/.test(filter.page)||Number(filter.page)>1000)throw new BadRequestException('Período máximo de 366 dias e página inválida.');
 return filter;
}
@Controller('admin/platform-communications') @PlatformScope()
export class PlatformCommunicationsController{
 constructor(private readonly db:SupabaseService){}
 @Get() @RequirePermission([TEAM_MANAGE,PLATFORM_SUPPORT_VIEW])
 async get(@Req() req:RequestWithAuthenticatedUser,@Query() query:Record<string,unknown>){
  const {data,error}=await this.db.getClient().rpc('read_platform_communications',{p_actor:req.authenticatedUser.userId,p_filter:communicationFilters(query)});
  if(error?.code==='42501')throw new ForbiddenException('Consulta exclusiva da equipe autorizada.');
  if(['22023','22007','22008'].includes(error?.code))throw new BadRequestException('Confira os filtros e o período.');
  if(error||!data)throw new ServiceUnavailableException('Consulta indisponível; nenhum envio foi alterado.');
  return data;
 }
}
