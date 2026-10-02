import {Injectable,BadRequestException,ConflictException,ForbiddenException,InternalServerErrorException,NotFoundException,UnauthorizedException} from '@nestjs/common';
import {SupabaseService} from '../../../services/supabase.service';
import {LicensesService} from '../../licenses/services/licenses.service';
import {TenantContext} from '../../../common/interfaces/tenant-context.interface';
import {PERMISSIONS as P} from '../../../common/constants/permissions';
import {validateWriteDto} from '../../../common/validation/validate-write-dto';
import {PreparationQueryDto} from '../dto/preparation.dto';
import {PrepareFinancialSettlementDto,FinancialSettlementTransitionDto} from '../dto/financial-settlements.dto';
import {CalculationPreparationService} from './preparation.service';
import {frozenPreparationClient} from './frozen-preparation-client';
import {customerFinancialPreview} from './customer-financial-preview';
import {adjustedContracts} from './fee-adjustment';
import {reviewDigest} from './review-snapshots.service';
import {feeCents,feeMoney} from './management-fee';
@Injectable()
export class FinancialSettlementsService {
 constructor(private db:SupabaseService,private licenses:LicensesService){}
 private client(){return this.db.getClient();}
 private fail(error:any){
  if(!error)return;
  if(error.code==='P8403')throw new ConflictException('As fontes mudaram. Prepare uma nova versão e confira novamente antes de aprovar ou publicar.');
  if(['P8402','23505'].includes(error.code))throw new ConflictException('A versão ou a solicitação mudou. Atualize o histórico antes de continuar.');
  if(error.code==='P8404')throw new NotFoundException('Apuração não encontrada nesta organização.');
  if(['P8401','23514','23502'].includes(error.code))throw new BadRequestException('Confira escopo, fontes, justificativa e aceite explícito das ressalvas.');
  throw new InternalServerErrorException('Não foi possível consultar ou registrar o fechamento financeiro.');
 }
 private async allowed(t:TenantContext,permission:string){
  if(!t.organizationId||!t.userId)throw new UnauthorizedException('Contexto organizacional ausente.');
  if(!t.permissions?.includes(permission)||!t.permissions.includes(P.ORGANIZATION_CONTRACTS_VIEW))throw new ForbiddenException('Permissão insuficiente para esta operação financeira.');
  await this.licenses.requireEntitlement(t.organizationId,'free_market_management');
 }
 canManage(t:TenantContext){return (['admin_org','gestor'].includes(t.role)||t.accessMode==='platform_operation')&&t.permissions.includes(P.ORGANIZATION_CONTRACTS_UPDATE);}
 private async unit(id:string,t:TenantContext){
  const u=await this.client().from('consumer_units').select('id,organization_id,customer_id').eq('id',id).eq('organization_id',t.organizationId).maybeSingle();this.fail(u.error);
  if(!u.data)throw new NotFoundException('Unidade não encontrada nesta organização.');
  await this.customer(u.data.customer_id,t);return u.data;
 }
 private async customer(id:string,t:TenantContext){
  const c=await this.client().from('customers').select('id').eq('id',id).eq('organization_id',t.organizationId).is('deleted_at',null).maybeSingle();this.fail(c.error);
  if(!c.data)throw new NotFoundException('Cliente indisponível nesta organização.');
 }
 private summary(row:any){const utc=(value:any)=>typeof value==='string'&&!/(Z|[+-][0-9]{2}:[0-9]{2})$/.test(value)?value+'Z':value;return {id:row.financial_group_id,consumerUnitId:row.consumer_unit_id,customerId:row.customer_id,month:String(row.month).slice(0,7),version:row.version_number,status:row.status,payloadHash:row.financial_hash,reservations:row.financial_reservations,note:row.preparation_note,approvalNote:row.approval_note,publicationNote:row.publication_note,createdBy:row.created_by,createdAt:utc(row.created_at),approvedBy:row.approved_by,approvedAt:utc(row.approved_at),publishedBy:row.published_by,publishedAt:utc(row.published_at)};}
 async list(input:PreparationQueryDto,t:TenantContext){
  await this.allowed(t,P.ORGANIZATION_CONTRACTS_VIEW);const d=await validateWriteDto(PreparationQueryDto,input);await this.unit(d.consumerUnitId,t);
  const r=await this.client().from('monthly_energy_settlements').select('financial_group_id,consumer_unit_id,customer_id,month,version_number,status,financial_hash,financial_reservations,preparation_note,approval_note,publication_note,created_by,created_at,approved_by,approved_at,published_by,published_at').eq('organization_id',t.organizationId).eq('consumer_unit_id',d.consumerUnitId).eq('month',d.month+'-01').eq('financial_format','financial-settlement-1.0').order('version_number',{ascending:false}).limit(101);this.fail(r.error);
  if(!Array.isArray(r.data)||r.data.length>100)throw new InternalServerErrorException('Histórico extenso; nenhum histórico parcial foi emitido.');
  return {rows:r.data.map((row:any)=>this.summary(row)),canManage:this.canManage(t)};
 }
 private async load(groupId:string,t:TenantContext){
  const r=await this.client().from('monthly_energy_settlements').select('*').eq('organization_id',t.organizationId).eq('financial_group_id',groupId).eq('financial_format','financial-settlement-1.0').order('consumer_unit_id').limit(101);this.fail(r.error);
  if(!Array.isArray(r.data)||!r.data.length)throw new NotFoundException('Apuração não encontrada nesta organização.');
  if(r.data.length>100)throw new InternalServerErrorException('Grupo financeiro extenso.');
  const first=r.data[0],payload=first.financial_payload;await this.customer(first.customer_id,t);
  if(!payload||payload.formatVersion!=='financial-settlement-1.0'||payload.sources?.organizationId!==t.organizationId||payload.sources?.customerId!==first.customer_id||payload.sources?.month!==String(first.month).slice(0,7)||reviewDigest(payload)!==first.financial_hash||payload.financial?.status!=='AVAILABLE'||!Array.isArray(payload.financial.units)||payload.financial.units.length!==r.data.length||r.data.some((row:any)=>row.financial_hash!==first.financial_hash||row.status!==first.status||row.customer_id!==first.customer_id||row.version_number!==first.version_number||!payload.financial.units.some((unit:any)=>unit.id===row.consumer_unit_id)))throw new InternalServerErrorException('A integridade da versão financeira não pôde ser confirmada.');
  return {rows:r.data,payload,first};
 }
 async one(groupId:string,t:TenantContext){
  await this.allowed(t,P.ORGANIZATION_CONTRACTS_VIEW);const {rows,payload,first}=await this.load(groupId,t);
  return {...this.summary(first),unitIds:rows.map((row:any)=>row.consumer_unit_id),financial:payload.financial,preparations:payload.preparations,preparedBy:payload.preparedBy,captureConsistency:'SINGLE_DATABASE_STATEMENT',canManage:this.canManage(t)};
 }
 async prepare(input:PrepareFinancialSettlementDto,t:TenantContext){
  await this.allowed(t,P.ORGANIZATION_CONTRACTS_CREATE);const d=await validateWriteDto(PrepareFinancialSettlementDto,input);const u=await this.unit(d.consumerUnitId,t);
  const prior=await this.client().from('monthly_energy_settlements').select('financial_group_id,customer_id,month,created_by,preparation_note').eq('organization_id',t.organizationId).eq('financial_request_id',d.requestId).limit(1);this.fail(prior.error);
  if(prior.data?.length){const old=prior.data[0];if(old.customer_id!==u.customer_id||String(old.month).slice(0,7)!==d.month||old.created_by!==t.userId||old.preparation_note!==d.note.trim())throw new ConflictException('A solicitação já foi usada para outra preparação.');return this.one(old.financial_group_id,t);}
  const captured=await this.client().rpc('capture_financial_sources',{p_org:t.organizationId,p_customer:u.customer_id,p_month:d.month});this.fail(captured.error);
  const sources=captured.data;
  if(sources?.formatVersion!=='financial-sources-1.0'||sources.organizationId!==t.organizationId||sources.customerId!==u.customer_id||sources.month!==d.month||!Array.isArray(sources.tables?.consumer_units))throw new InternalServerErrorException('Captura financeira indisponível.');
  const tables=sources.tables,units=tables.consumer_units;
  const frozenClient=frozenPreparationClient(tables);
  const frozenDb={getClient:()=>frozenClient} as unknown as SupabaseService;
  const engine=new CalculationPreparationService(frozenDb,this.licenses);
  const preparations:Record<string,Awaited<ReturnType<CalculationPreparationService['inspect']>>>={};
  for(let offset=0;offset<units.length;offset+=4){await Promise.all(units.slice(offset,offset+4).map(async(unit:any)=>{
   const result=await engine.inspect({consumerUnitId:unit.id,month:d.month},t.organizationId);
   if(result.counts.blockers!==0)throw new BadRequestException('Resolva os bloqueios da unidade '+(unit.name||unit.id)+' antes de preparar o fechamento.');
   preparations[unit.id]=result;
  }));}
  const financial=customerFinancialPreview(t.organizationId,u.customer_id,d.month,units,units.map((unit:any)=>({unitId:unit.id,month:d.month,composition:preparations[unit.id].operationalComposition,checkedAt:preparations[unit.id].checkedAt})),adjustedContracts(tables.management_contracts,tables.commercial_fee_adjustments,d.month),tables.management_fee_allocations);
  if(financial.status!=='AVAILABLE'||financial.blockers.length)throw new BadRequestException(financial.blockers.join(' ')||'Consolidado financeiro indisponível.');
  const reservations=[...new Set([d.note.trim(),...Object.values(preparations).flatMap(result=>[...result.findings.filter(f=>f.severity==='REVIEW').map(f=>f.message),...(result.operationalComposition.qualifications??[])])])];
  const payload={formatVersion:'financial-settlement-1.0',sources,financial,preparations,reservations,preparedBy:{id:t.userId,role:t.role},preparedAt:new Date().toISOString(),consistency:'SINGLE_DATABASE_STATEMENT',calculationCommit:process.env.RAILWAY_GIT_COMMIT_SHA??null};
  if(Buffer.byteLength(JSON.stringify(payload),'utf8')>8000000)throw new BadRequestException('Captura extensa demais para um fechamento seguro.');
  const records=financial.units.map(unit=>{
   const contract=preparations[unit.id].contractSupplierCost.contract;
   if(!contract?.id)throw new BadRequestException('Contrato fornecedor indisponível para preservar a origem da apuração.');
   const consumptionKwh=preparations[unit.id].measurements.validatedVersion?.measurements.consumptionTotal;
   if(typeof consumptionKwh!=='string')throw new BadRequestException('Consumo validado indisponível para esta versão.');
   return {unitId:unit.id,contractId:contract.id,consumptionKwh,acr:unit.acr,aclBeforeFees:unit.aclBeforeFees,savingsBeforeFees:feeMoney(feeCents(unit.acr!)-feeCents(unit.aclBeforeFees!)),totalFees:unit.totalFees,savingsAfterFees:unit.savingsAfterFees};
  });
  const saved=await this.client().rpc('prepare_financial_settlement',{p_org:t.organizationId,p_customer:u.customer_id,p_month:d.month,p_actor:t.userId,p_request:d.requestId,p_note:d.note.trim(),p_payload:payload,p_hash:reviewDigest(payload),p_reservations:reservations,p_units:records});this.fail(saved.error);
  return this.one(saved.data,t);
 }
 async transition(groupId:string,input:FinancialSettlementTransitionDto,action:'APPROVE'|'PUBLISH',t:TenantContext){
  await this.allowed(t,P.ORGANIZATION_CONTRACTS_UPDATE);
  if(!this.canManage(t))throw new ForbiddenException('A aprovação e publicação exigem Gestor ou Administrador da organização.');
  const d=await validateWriteDto(FinancialSettlementTransitionDto,input);await this.load(groupId,t);
  const r=await this.client().rpc('transition_financial_settlement',{p_org:t.organizationId,p_group:groupId,p_actor:t.userId,p_hash:d.payloadHash,p_action:action,p_note:d.note.trim(),p_ack:d.acknowledgeReservations});this.fail(r.error);
  return this.one(groupId,t);
 }
}
