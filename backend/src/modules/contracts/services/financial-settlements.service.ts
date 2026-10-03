import {Injectable,BadRequestException,ConflictException,ForbiddenException,InternalServerErrorException,NotFoundException,UnauthorizedException} from '@nestjs/common';
import {SupabaseService} from '../../../services/supabase.service';
import {LicensesService} from '../../licenses/services/licenses.service';
import {TenantContext} from '../../../common/interfaces/tenant-context.interface';
import {PERMISSIONS as P} from '../../../common/constants/permissions';
import {validateWriteDto} from '../../../common/validation/validate-write-dto';
import {PreparationQueryDto} from '../dto/preparation.dto';
import {PrepareFinancialSettlementDto,FinancialSettlementTransitionDto,PublishedFinancialQueryDto,PortalFinancialQueryDto} from '../dto/financial-settlements.dto';
import {publishedFinancialSummary} from './published-financial-summary';
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
 async published(input:PublishedFinancialQueryDto,t:TenantContext){
  await this.allowed(t,P.ORGANIZATION_CONTRACTS_VIEW);
  if(!['admin_org','gestor','operacional'].includes(t.role)&&t.accessMode!=='platform_operation')throw new ForbiddenException('O painel financeiro exige acesso de Backoffice.');
  const d=await validateWriteDto(PublishedFinancialQueryDto,input);
  return this.publishedRead(d,t);
 }
 private async publishedRead(d:PublishedFinancialQueryDto,t:TenantContext){
  const ordinal=(m:string)=>Number(m.slice(0,4))*12+Number(m.slice(5,7));
  if(d.from>d.to||ordinal(d.to)-ordinal(d.from)>=12)throw new BadRequestException('Selecione um período de até 12 meses, em ordem crescente.');
  if(d.customerId)await this.customer(d.customerId,t);
  let query=this.client().from('monthly_energy_settlements').select('financial_group_id,customer_id,month,version_number,status,validation_status,financial_hash').eq('organization_id',t.organizationId).eq('financial_format','financial-settlement-1.0').eq('status','PUBLISHED').eq('validation_status','VALIDATED').gte('month',d.from+'-01').lte('month',d.to+'-01');
  if(d.customerId)query=query.eq('customer_id',d.customerId);
  const result=await query.order('month',{ascending:false}).order('version_number',{ascending:false}).limit(1000);this.fail(result.error);
  if(!Array.isArray(result.data)||result.data.length>=1000)throw new BadRequestException('Consulta extensa. Reduza o período ou selecione um cliente; nenhum total parcial foi emitido.');
  const latest=new Map<string,any>();
  for(const row of result.data){
   const month=String(row.month).slice(0,7),key=row.customer_id+'|'+month;
   if(row.status!=='PUBLISHED'||row.validation_status!=='VALIDATED'||!row.financial_group_id||!Number.isInteger(row.version_number)||row.version_number<1||month<d.from||month>d.to||(d.customerId&&row.customer_id!==d.customerId))throw new InternalServerErrorException('Publicação fora do escopo solicitado.');
   const prior=latest.get(key);
   if(!prior||row.version_number>prior.version_number)latest.set(key,row);
   else if(row.version_number===prior.version_number&&(row.financial_group_id!==prior.financial_group_id||row.financial_hash!==prior.financial_hash))throw new InternalServerErrorException('Versão publicada ambígua.');
  }
  const publications=[];
  for(const row of latest.values()){
   const loaded=await this.load(row.financial_group_id,t);
   if(loaded.first.status!=='PUBLISHED'||loaded.rows.some((r:any)=>r.validation_status!=='VALIDATED'||!r.approved_at||!r.published_at||!r.published_by)||loaded.first.customer_id!==row.customer_id||loaded.first.version_number!==row.version_number||loaded.first.financial_hash!==row.financial_hash||String(loaded.first.month)!==String(row.month))throw new InternalServerErrorException('A publicação mudou durante a consulta. Atualize o painel.');
   publications.push({meta:this.summary(loaded.first),financial:loaded.payload.financial,customerName:loaded.payload.sources.tables?.customers?.find((c:any)=>c.id===row.customer_id)?.company_name??row.customer_id,reservations:loaded.payload.reservations});
  }
  return publishedFinancialSummary(t.organizationId,d,publications);
 }
 private async portalMember(t:TenantContext){
  if(!t.organizationId||!t.userId)throw new UnauthorizedException('Contexto organizacional ausente.');
  if(t.accessMode||t.role!=='consulta')return null;
  const r=await this.client().from('organization_members').select('organization_id,user_id,role_id,status,affiliation_type,exclusive_customer_id,roles(id,name,scope,organization_id,permissions)').eq('organization_id',t.organizationId).eq('user_id',t.userId).eq('status','active').maybeSingle();this.fail(r.error);
  const member=r.data,role=member?.roles;
  if(!member||member.organization_id!==t.organizationId||member.user_id!==t.userId||member.status!=='active'||member.role_id!==t.roleId||role?.id!==t.roleId||role?.organization_id!==t.organizationId||role?.scope!=='organization'||role?.name!=='consulta')throw new ForbiddenException('Vínculo de consulta indisponível. Atualize seu acesso.');
  return member.affiliation_type==='external'?member:null;
 }
 async portalAccess(t:TenantContext){
  const member=await this.portalMember(t);
  return {organizationId:t.organizationId,audience:typeof member?.exclusive_customer_id==='string'&&member.exclusive_customer_id?'client':'backoffice'};
 }
 private async portalCustomer(t:TenantContext){
  const member=await this.portalMember(t);
  if(!member||!t.permissions?.includes(P.DOCUMENTS_REPORTS_VIEW)||!Array.isArray(member.roles.permissions)||!member.roles.permissions.includes(P.DOCUMENTS_REPORTS_VIEW)||typeof member.exclusive_customer_id!=='string'||!member.exclusive_customer_id)throw new ForbiddenException('O portal exige consulta externa, permissão de relatórios e vínculo exclusivo com um cliente. Solicite a conferência à equipe de gestão.');
  await this.licenses.requireEntitlement(t.organizationId,'free_market_management');
  const c=await this.client().from('customers').select('id,organization_id,status').eq('id',member.exclusive_customer_id).eq('organization_id',t.organizationId).is('deleted_at',null).maybeSingle();this.fail(c.error);
  if(!c.data||c.data.id!==member.exclusive_customer_id||c.data.organization_id!==t.organizationId||c.data.status!=='ACTIVE')throw new ForbiddenException('Cliente indisponível para consulta. Solicite a conferência à equipe de gestão.');
  return member.exclusive_customer_id as string;
 }
 async portalFinancial(input:PortalFinancialQueryDto,t:TenantContext){
  const customerId=await this.portalCustomer(t),d=await validateWriteDto(PortalFinancialQueryDto,input);
  const result=await this.publishedRead({...d,customerId},t);
  if(await this.portalCustomer(t)!==customerId)throw new ForbiddenException('O vínculo mudou durante a consulta. Atualize o portal.');
  return this.clientProjection(result,customerId);
 }
 async portalPreview(input:PublishedFinancialQueryDto,t:TenantContext){
  if(!['admin_org','gestor'].includes(t.role)&&t.accessMode!=='platform_operation')throw new ForbiddenException('A prévia do portal exige gestor ou administrador.');
  if(!input.customerId)throw new BadRequestException('Selecione um cliente publicado para conferir o portal.');
  const result=await this.published(input,t);
  return this.clientProjection(result,input.customerId);
 }
 private clientProjection(result:ReturnType<typeof publishedFinancialSummary>,customerId:string){
  // Deliberately project published figures only; never expose OCR, captured tables or internal notes.
  return {...result,audience:'client',customerId,disclosure:'Somente a última versão publicada de cada mês do seu cliente. Meses sem publicação não representam custo zero. Publicações com ressalvas exigem consulta à equipe de gestão sobre as condições desta versão.',rows:result.rows.map(row=>({id:row.id,customerId:row.customerId,customerName:row.customerName,month:row.month,version:row.version,publishedAt:row.publishedAt,payloadHash:row.payloadHash,units:row.units,amounts:row.amounts,publicationNote:'',reservations:row.reservations.length?['Resultado publicado com ressalvas. Consulte sua equipe de gestão para conhecer as condições desta versão.']:[]}))};
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
