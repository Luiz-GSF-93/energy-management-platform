import {Injectable,InternalServerErrorException,NotFoundException} from '@nestjs/common';
import {SupabaseService} from '../../../services/supabase.service';
import {LicensesService} from '../../licenses/services/licenses.service';
import {validateWriteDto} from '../../../common/validation/validate-write-dto';
import {PreparationQueryDto} from '../dto/preparation.dto';
import {prepareMonth,monthPeriod} from './preparation';
import {previewTariffs} from './tariff-preview';
@Injectable()
export class CalculationPreparationService {
 constructor(private db:SupabaseService,private licenses:LicensesService){}
 private table(name:string){return this.db.getClient().from(name);}
 private fail(error:any){if(error)throw new InternalServerErrorException('Não foi possível conferir os dados da competência. Tente novamente.');}
 // Explicit paging avoids a silently truncated catalog at the PostgREST row limit.
 private async all(query:()=>any){const rows:any[]=[];for(let offset=0;offset<20000;offset+=200){const r=await query().order('id',{ascending:true}).range(offset,offset+199);this.fail(r.error);if(!Array.isArray(r.data))throw new InternalServerErrorException('Resposta de cadastro indisponível.');rows.push(...r.data);if(r.data.length<200)return rows;}throw new InternalServerErrorException('Cadastro muito extenso para esta consulta. Nenhum diagnóstico parcial foi emitido.');}
 async inspect(input:PreparationQueryDto,org:string){await this.licenses.requireEntitlement(org,'free_market_management');const d=await validateWriteDto(PreparationQueryDto,input);const unitResult=await this.table('consumer_units').select('*').eq('id',d.consumerUnitId).eq('organization_id',org).maybeSingle();this.fail(unitResult.error);const u=unitResult.data;if(!u)throw new NotFoundException('Unidade não encontrada nesta organização.');const customer=await this.table('customers').select('id').eq('id',u.customer_id).eq('organization_id',org).is('deleted_at',null).maybeSingle();this.fail(customer.error);if(!customer.data)throw new NotFoundException('Cliente indisponível nesta organização.');
 const [parameters,contracts,management,services,monthly,monthlyCosts]=await Promise.all([
 this.all(()=>this.table('calculation_parameters').select('*').eq('organization_id',org).eq('consumer_unit_id',u.id)),
 this.all(()=>this.table('energy_contracts').select('*').eq('organization_id',org).eq('consumer_unit_id',u.id)),
 this.all(()=>this.table('management_contracts').select('*').eq('organization_id',org).eq('customer_id',u.customer_id)),
 this.all(()=>this.table('service_agreements').select('*').eq('organization_id',org).eq('customer_id',u.customer_id)),
 this.all(()=>this.table('calculation_monthly_inputs').select('*').eq('organization_id',org).eq('customer_id',u.customer_id).eq('consumer_unit_id',u.id).eq('month',d.month)),
 this.all(()=>this.table('calculation_monthly_costs').select('*').eq('organization_id',org).eq('customer_id',u.customer_id).eq('consumer_unit_id',u.id).eq('month',d.month))]);
 const period=monthPeriod(d.month),ids=contracts.filter(c=>['ACTIVE','APPROVED'].includes(c.status)&&c.contract_type==='ENERGY_PURCHASE'&&String(c.start_date).slice(0,10)<=period.end&&(!c.end_date||String(c.end_date).slice(0,10)>=period.start)).map(c=>c.id),prices:any[]=[];
 for(let i=0;i<ids.length;i+=100){const batch=ids.slice(i,i+100);prices.push(...await this.all(()=>this.table('contract_price_history').select('*').in('contract_id',batch)));}
 return {...prepareMonth(u,d.month,parameters,contracts,prices,management,services,monthly,monthlyCosts),tariffPreview:previewTariffs(u,d.month,period,parameters,monthly),checkedAt:new Date().toISOString()};
 }
}
