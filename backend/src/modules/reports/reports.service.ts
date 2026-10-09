import {InvestmentsService} from './investments.service';
import {investmentReturn} from './investment-return';
import {BadRequestException,ConflictException,ForbiddenException,Injectable,InternalServerErrorException,NotFoundException,Optional} from '@nestjs/common';
import {EnergyForecastService} from '../energy-forecast/energy-forecast.service';
import {SupabaseService} from '../../services/supabase.service';
import {LicensesService} from '../licenses/services/licenses.service';
import {FinancialSettlementsService} from '../contracts/services/financial-settlements.service';
import {TenantContext} from '../../common/interfaces/tenant-context.interface';
import {PERMISSIONS as P} from '../../common/constants/permissions';
import {validateWriteDto} from '../../common/validation/validate-write-dto';
import {CreateReportDto} from './report.dto';
import {projectReport,REPORT_FORMAT,reportHash} from './report.projection';
@Injectable()
export class ReportsService {
 constructor(private db:SupabaseService,private licenses:LicensesService,private financial:FinancialSettlementsService,@Optional() private forecast?:EnergyForecastService,@Optional() private investments?:InvestmentsService){}
 private client(){return this.db.getClient();}
 private fail(e:any){if(!e)return;if(e.code==='42501')throw new ForbiddenException('Acesso a relatórios revogado ou sem licença.');if(e.code==='P3862')throw new NotFoundException('Relatório ou unidade indisponível nesta organização.');if(['40001','23505'].includes(e.code))throw new ConflictException('Recorte ou requisição alterado. Atualize antes de gerar.');if(['22023','23514'].includes(e.code))throw new BadRequestException('Revise o recorte do relatório.');throw new InternalServerErrorException('Não foi possível consultar os relatórios.');}
 async access(t:TenantContext,write=false){
  if(!t?.organizationId||!t.userId||!t.permissions?.includes(P.DOCUMENTS_REPORTS_VIEW)||!t.permissions.includes(P.ORGANIZATION_CONTRACTS_VIEW)||(write&&!t.permissions.includes(P.DOCUMENTS_REPORTS_CREATE))||(!['admin_org','gestor','operacional'].includes(t.role)&&t.accessMode!=='platform_operation'))throw new ForbiddenException('Relatórios disponíveis ao backoffice autorizado.');
  await this.licenses.requireEntitlement(t.organizationId,'report_generation');await this.licenses.requireEntitlement(t.organizationId,'free_market_management');
  const r=await this.client().rpc('assert_report_actor',{p_org:t.organizationId,p_actor:t.userId,p_write:write});this.fail(r.error);
 }
 private async header(customerId:string,unitId:string,t:TenantContext){
  const c=await this.client().from('customers').select('id,company_name,contact_name,contact_email,status').eq('organization_id',t.organizationId).eq('id',customerId).is('deleted_at',null).maybeSingle();this.fail(c.error);
  const u=await this.client().from('consumer_units').select('id,customer_id,name,consumer_unit_number,address,city,state,distributor,status').eq('organization_id',t.organizationId).eq('customer_id',customerId).eq('id',unitId).maybeSingle();this.fail(u.error);
  if(!c.data||!u.data||c.data.status!=='ACTIVE'||u.data.status!=='ACTIVE')throw new NotFoundException('Cliente ou unidade ativos indisponíveis nesta organização.');
  return {organizationId:t.organizationId,organizationName:t.organizationName??t.organizationId,customerId,customerName:c.data.company_name,unitId,unitName:u.data.name,unitCode:u.data.consumer_unit_number,address:u.data.address,city:u.data.city,state:u.data.state,distributor:u.data.distributor,contactName:c.data.contact_name,contactEmail:c.data.contact_email};
 }
 async create(input:unknown,t:TenantContext){
  await this.access(t,true);const d=await validateWriteDto<CreateReportDto>(CreateReportDto,input as CreateReportDto);
  const span=(Number(d.to.slice(0,4))-Number(d.from.slice(0,4)))*12+Number(d.to.slice(5))-Number(d.from.slice(5))+1;
  if(span<1||span>12)throw new BadRequestException('Selecione um período de até 12 meses.');
  const prior=await this.client().from('published_report_snapshots').select('*').eq('organization_id',t.organizationId).eq('request_id',d.requestId).maybeSingle();this.fail(prior.error);
  if(prior.data){if(prior.data.created_by!==t.userId||Object.entries(d).some(([k,v])=>prior.data.request[k]!==v))throw new ConflictException('Requisição já utilizada com outro recorte.');await this.header(d.customerId,d.unitId,t);return this.verified(prior.data);}
  const header=await this.header(d.customerId,d.unitId,t);
  const financial=await this.financial.reports({from:d.from,to:d.to,customerId:d.customerId,unitId:d.unitId},t);
  let events:any[]=[];
  if(t.permissions.includes(P.OPERACAO_EVENTS_VIEW)){
   const last=new Date(Date.UTC(Number(d.to.slice(0,4)),Number(d.to.slice(5)),0)).toISOString().slice(0,10);
   const e=await this.client().from('operation_records').select('id,revision,title,priority,effective_date').eq('organization_id',t.organizationId).eq('kind','events').eq('status','PUBLISHED').eq('customer_id',d.customerId).eq('consumer_unit_id',d.unitId).gte('effective_date',d.from+'-01').lte('effective_date',last).order('effective_date',{ascending:false}).limit(201);this.fail(e.error);if(e.data?.length>200)throw new BadRequestException('Há muitos eventos. Reduza o período.');events=e.data??[];
  }
  const base=projectReport(financial,header,d.kind,events,new Date().toISOString());
  const body={...base,annualProjection:d.kind==='OPERATIONAL'&&this.forecast?.enabled?await this.forecast.publishedForReport(d.customerId,d.unitId,d.to,t):null};
  if(d.kind==='EXECUTIVE'&&this.investments){
   const investment=await this.investments.validated(t,d.customerId,d.unitId);
   if(investment){
    const start=investment.body.startMonth,ordinal=(m:string)=>Number(m.slice(0,4))*12+Number(m.slice(5)),count=ordinal(d.to)-ordinal(start)+1;
    if(count>120)throw new BadRequestException('Histórico de ROI limitado a 120 meses.');
    const months:any[]=[],references:any[]=[];
    if(count>0)for(let offset=0;offset<count;offset+=12){const index=ordinal(start)+offset,end=Math.min(index+11,ordinal(d.to)),format=(v:number)=>`${Math.floor((v-1)/12)}-${String((v-1)%12+1).padStart(2,'0')}`;
     const result=await this.financial.reports({from:format(index),to:format(end),customerId:d.customerId,unitId:d.unitId},t);months.push(...result.primary.months);references.push(...result.primary.publications.map((p:any)=>({id:p.id,version:p.version,month:p.month,payloadHash:p.payloadHash,publishedAt:p.publishedAt})));
    }
    (body as any).roi={...investmentReturn(investment,months,d.to),publications:references};body.unavailable=body.unavailable.filter(v=>!v.startsWith('ROI:'));
   }
  }
  if(!t.permissions.includes(P.OPERACAO_EVENTS_VIEW))body.unavailable.push('Eventos: consulta não autorizada para este perfil.');
  const hash=reportHash(body),r=await this.client().rpc('capture_published_report',{p_org:t.organizationId,p_actor:t.userId,p_request:d,p_body:body,p_hash:hash});this.fail(r.error);return this.verified(r.data);
 }
 private verified(row:any){if(!row?.body||row.body.formatVersion!==REPORT_FORMAT||row.body.header?.organizationId!==row.organization_id||row.body.header.customerId!==row.customer_id||row.body.header.unitId!==row.consumer_unit_id||row.payload_hash!==reportHash(row.body))throw new InternalServerErrorException('Integridade do relatório indisponível.');return row;}
 async selection(t:TenantContext){
  await this.access(t);
  const c=await this.client().from('customers').select('id,company_name').eq('organization_id',t.organizationId).eq('status','ACTIVE').is('deleted_at',null).order('company_name');this.fail(c.error);
  const u=await this.client().from('consumer_units').select('id,customer_id,name').eq('organization_id',t.organizationId).eq('status','ACTIVE').order('name');this.fail(u.error);
  const ids=new Set((c.data??[]).map((x:any)=>x.id));return {customers:c.data??[],units:(u.data??[]).filter((x:any)=>ids.has(x.customer_id))};
 }
 async list(t:TenantContext,q?:Record<string,string>){
  await this.access(t);
  if(q&&Object.keys(q).length){
   const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,month=/^(20|21)\d{2}-(0[1-9]|1[0-2])$/;
   if(Object.keys(q).some(k=>!['customerId','unitId','from','to','kind'].includes(k))||!uuid.test(q.customerId??'')||!uuid.test(q.unitId??'')||!month.test(q.from??'')||!month.test(q.to??'')||q.from>q.to||!['OPERATIONAL','EXECUTIVE'].includes(q.kind))throw new BadRequestException('Selecione empresa, unidade, período e tipo válidos.');
   await this.header(q.customerId,q.unitId,t);
   const r=await this.client().rpc('read_selected_reports',{p_org:t.organizationId,p_actor:t.userId,p_customer:q.customerId,p_unit:q.unitId,p_from:q.from,p_to:q.to,p_kind:q.kind});this.fail(r.error);return r.data;
  }
  const r=await this.client().rpc('read_published_reports',{p_org:t.organizationId,p_actor:t.userId,p_id:null});this.fail(r.error);return r.data;
 }
 async one(id:string,t:TenantContext){await this.access(t);const r=await this.client().rpc('read_published_reports',{p_org:t.organizationId,p_actor:t.userId,p_id:id});this.fail(r.error);return this.verified(r.data);}
}
