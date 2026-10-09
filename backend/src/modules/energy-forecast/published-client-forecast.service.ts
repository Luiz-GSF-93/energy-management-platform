import {ForbiddenException,Injectable,InternalServerErrorException} from '@nestjs/common';
import {ConfigService} from '@nestjs/config';
import {SupabaseService} from '../../services/supabase.service';
import {LicensesService} from '../licenses/services/licenses.service';
import {TenantContext} from '../../common/interfaces/tenant-context.interface';
import {PERMISSIONS as P} from '../../common/constants/permissions';
import {reportHash} from '../reports/report.projection';

@Injectable()
export class PublishedClientForecastService {
 constructor(private db:SupabaseService,private licenses:LicensesService,private config:ConfigService){}
 async list(t:TenantContext){
  if(this.config.get('ENERGY_FORECAST_ENABLED')!=='true'||!t?.organizationId||!t.userId||!t.roleId||t.role!=='consulta'||t.accessMode||!t.permissions?.includes(P.DOCUMENTS_REPORTS_VIEW))throw new ForbiddenException('Consulta externa vinculada ao cliente necessária.');
  await this.licenses.requireEntitlement(t.organizationId,'report_generation');
  await this.licenses.requireEntitlement(t.organizationId,'free_market_management');
  // Customer is derived in SQL from live membership. No customer/unit selector is accepted.
  const {data,error}=await this.db.getClient().rpc('energy_forecast_client_published',{p_org:t.organizationId,p_actor:t.userId,p_role:t.roleId});
  if(error){if(error.code==='42501')throw new ForbiddenException('Vínculo, permissão ou licença indisponível.');throw new InternalServerErrorException('Não foi possível consultar as previsões publicadas.');}
  if(!data?.customerId||!Array.isArray(data.rows))throw new InternalServerErrorException('Consulta de previsão indisponível.');
  const rows=data.rows.map((r:any)=>{
   const b=r.body;
   if(r.organization_id!==t.organizationId||r.customer_id!==data.customerId||b?.organizationId!==t.organizationId||b.customerId!==data.customerId||b.unitId!==r.consumer_unit_id||b.asOfMonth!==r.cutoff||r.payload_hash!==reportHash(b)||!r.publishedAt||!r.validatedAt)throw new InternalServerErrorException('Integridade da previsão indisponível.');
   return {id:r.id,version:r.version,unitId:r.consumer_unit_id,unitName:r.unitName,asOfMonth:b.asOfMonth,publishedAt:r.publishedAt,
    formulaVersion:b.formulaVersion,method:b.method,weatherStatus:b.weatherStatus,
    actual:b.actual.map((a:any)=>({month:a.month,consumptionKwh:a.consumptionKwh})),
    future:b.future.map((a:any)=>({month:a.month,predictedKwh:a.predictedKwh,expansionKwh:a.expansionKwh,averageBasis:a.averageBasis})),
    observedYearKwh:b.observedYearKwh,futureKwh:b.futureKwh,estimatedYearKwh:b.estimatedYearKwh};
  });
  return {rows};
 }
}
