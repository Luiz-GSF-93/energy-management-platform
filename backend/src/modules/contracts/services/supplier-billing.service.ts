import {prepareMeasurements} from './preparation-measurements';
import {lastClosedSupplierMonth} from './supplier-cycle';
import {Injectable,ForbiddenException,NotFoundException,BadRequestException,ConflictException,InternalServerErrorException} from '@nestjs/common';
import {SupabaseService} from '../../../services/supabase.service';
import {LicensesService} from '../../licenses/services/licenses.service';
import {TenantContext} from '../../../common/interfaces/tenant-context.interface';
import {validateWriteDto} from '../../../common/validation/validate-write-dto';
import {SupplierBillingDto,SupplierBillingQueryDto,SupplierCycleQueryDto} from '../dto/supplier-billing.dto';
import {auditAuthorNames} from './audit-author-names';
@Injectable()
export class SupplierBillingService {
 constructor(private db:SupabaseService,private licenses:LicensesService){}
 canConfigure(t:TenantContext){return t.accessMode==='platform_operation'||['gestor','admin_org'].includes(t.role);}
 private fail(e:any){if(!e)return;if(['P5402','23505'].includes(e.code))throw new ConflictException('As condições foram atualizadas. Consulte a versão mais recente e informe o motivo da alteração.');if(['P5401','22007','22008','23514'].includes(e.code))throw new BadRequestException('Confira a vigência, os limites, o reajuste e a fonte da regra contratual.');throw new InternalServerErrorException('Não foi possível consultar ou registrar as condições de faturamento.');}
 private async context(id:string,t:TenantContext){await this.licenses.requireEntitlement(t.organizationId,'free_market_management');const r=await this.db.getClient().from('energy_contracts').select('*').eq('id',id).eq('organization_id',t.organizationId).maybeSingle();this.fail(r.error);if(!r.data||r.data.contract_type!=='ENERGY_PURCHASE')throw new NotFoundException('Contrato de fornecedor não encontrado nesta organização.');const c=await this.db.getClient().from('customers').select('id').eq('id',r.data.customer_id).eq('organization_id',t.organizationId).is('deleted_at',null).maybeSingle();this.fail(c.error);if(!c.data)throw new NotFoundException('Cliente indisponível.');return r.data;}
 async list(input:SupplierBillingQueryDto,t:TenantContext){const d=await validateWriteDto(SupplierBillingQueryDto,input),c=await this.context(d.contractId,t);const r=await this.db.getClient().from('supplier_billing_rules').select('*').eq('organization_id',t.organizationId).eq('contract_id',c.id).order('version',{ascending:false}).range(0,999);this.fail(r.error);if(!Array.isArray(r.data)||r.data.length>=1000)throw new InternalServerErrorException('Histórico indisponível ou extenso.');return {rows:await auditAuthorNames(this.db.getClient(),t.organizationId,r.data),canConfigure:this.canConfigure(t)};}
 async create(input:SupplierBillingDto,t:TenantContext){if(!this.canConfigure(t))throw new ForbiddenException('A confirmação exige Gestor ou Administrador.');const d=await validateWriteDto(SupplierBillingDto,input),c=await this.context(d.contractId,t);const r=await this.db.getClient().from('supplier_billing_rules').insert([{organization_id:t.organizationId,customer_id:c.customer_id,consumer_unit_id:c.consumer_unit_id,contract_id:c.id,start_date:d.startDate,end_date:d.endDate,volume_basis:d.volumeBasis,min_percent:d.minPercent,max_tolerance_percent:d.maxTolerancePercent,price_mode:d.priceMode,index_percent:d.indexPercent??null,index_source:d.indexSource?.trim()||null,tax_treatment:d.taxTreatment,source:d.source.trim(),reason:d.reason.trim(),previous_id:d.previousId??null,created_by:t.userId}]).select().single();this.fail(r.error);return (await auditAuthorNames(this.db.getClient(),t.organizationId,[r.data]))[0];}

 private async allRows(query:()=>any){const rows:any[]=[];for(let offset=0;offset<20000;offset+=200){const r=await query().order('id',{ascending:true}).range(offset,offset+199);this.fail(r.error);if(!Array.isArray(r.data))throw new InternalServerErrorException('Consulta de ciclo indisponível.');rows.push(...r.data);if(r.data.length<200)return rows;}throw new InternalServerErrorException('Consulta extensa; nenhum ciclo parcial foi informado.');}
 async cycle(input:SupplierCycleQueryDto,t:TenantContext){
  const d=await validateWriteDto(SupplierCycleQueryDto,input);await this.licenses.requireEntitlement(t.organizationId,'free_market_management');const db=this.db.getClient();
  const customer=await db.from('customers').select('id').eq('id',d.customerId).eq('organization_id',t.organizationId).is('deleted_at',null).maybeSingle();this.fail(customer.error);if(!customer.data)throw new NotFoundException('Cliente indisponível nesta organização.');
  const month=lastClosedSupplierMonth();const [units,contracts,inputs]=await Promise.all([
   this.allRows(()=>db.from('consumer_units').select('*').eq('organization_id',t.organizationId).eq('customer_id',d.customerId)),
   this.allRows(()=>db.from('energy_contracts').select('*').eq('organization_id',t.organizationId).eq('customer_id',d.customerId)),
   this.allRows(()=>db.from('calculation_monthly_inputs').select('*').eq('organization_id',t.organizationId).eq('customer_id',d.customerId).eq('month',month))]);
  const start=month+'-01',end=new Date(Date.UTC(Number(month.slice(0,4)),Number(month.slice(5)),0)).toISOString().slice(0,10);
  const rows=units.filter(u=>u.free_market===true&&contracts.some(c=>c.consumer_unit_id===u.id&&c.contract_type==='ENERGY_PURCHASE'&&['ACTIVE','APPROVED'].includes(c.status)&&String(c.start_date).slice(0,10)<=end&&String(c.end_date).slice(0,10)>=start)).map(u=>{const measured=prepareMeasurements(u,month,inputs);return {consumerUnitId:u.id,name:u.name,needsVolume:measured.status!=='VALIDATED'||measured.findings.some(f=>f.severity==='BLOCKER')};});
  return {month,rows};
 }
}
