import {normalizePublishedDetail} from './portal-legacy-detail';
import {Module,Injectable,Controller,Get,Query,Header,ForbiddenException,BadRequestException,InternalServerErrorException} from '@nestjs/common';
import {Tenant} from '../../common/decorators/tenant.decorator';
import {TenantContext} from '../../common/interfaces/tenant-context.interface';
import {SupabaseService} from '../../services/supabase.service';
import {clientPublishedInsight} from './portal-insights.model';
@Injectable()
export class PortalInsightsService {
 constructor(private db:SupabaseService){}
 async read(t:TenantContext,from:string,to:string,unitId?:string){
  if(t.role!=='consulta'||t.accessMode||!t.organizationId||!t.userId||!t.roleId)throw new ForbiddenException('Use o Portal do cliente.');
  if(!/^20\d{2}-(0[1-9]|1[0-2])$/.test(from??'')||!/^20\d{2}-(0[1-9]|1[0-2])$/.test(to??'')||from>to||(Number(to.slice(0,4))-Number(from.slice(0,4)))*12+Number(to.slice(5))-Number(from.slice(5))>11)throw new BadRequestException('Selecione até 12 meses.');
  const db=this.db.getClient();const binding=await db.rpc('client_portal_entitlement',{p_org:t.organizationId,p_actor:t.userId,p_role:t.roleId,p_module:'reports'});
  if(binding.error||binding.data?.enabled!==true||binding.data.organizationId!==t.organizationId||!binding.data.customerId)throw new ForbiddenException('Licença ou vínculo indisponível.');
  const customer=binding.data.customerId,r=await db.rpc(process.env.PORTAL_FINANCIAL_DETAIL_V2_ENABLED==='true'?'read_portal_financial_components_v2':'read_eva_published_components',{p_org:t.organizationId,p_actor:t.userId,p_role:t.roleId,p_platform:false,p_portal:true,p_from:from,p_to:to,p_customer:customer});
  if(r.error||!Array.isArray(r.data))throw new InternalServerErrorException('Detalhes publicados indisponíveis.');
  if(r.data.some((x:any)=>x.customerId!==customer||x.month<from||x.month>to||typeof x.unitId!=='string'))throw new ForbiddenException('Escopo dos componentes divergente.');
  const rows=r.data.filter((x:any)=>!unitId||x.unitId===unitId).map((r:any)=>clientPublishedInsight(normalizePublishedDetail(r,t.organizationId),process.env.PORTAL_FINANCIAL_DETAIL_V2_ENABLED==='true'));
  return {organizationId:t.organizationId,customerId:customer,from,to,rows};
 }
}
@Controller('portal/financial-details')
class PortalInsightsController {
 constructor(private service:PortalInsightsService){}
 @Get() @Header('Cache-Control','no-store') read(@Tenant() t:TenantContext,@Query() q:Record<string,string>){if(Object.keys(q).some(k=>!['from','to'].includes(k)))throw new BadRequestException('Filtros inválidos.');return this.service.read(t,q.from,q.to);}
}
@Module({controllers:[PortalInsightsController],providers:[SupabaseService,PortalInsightsService],exports:[PortalInsightsService]})
export class PortalInsightsModule {}
