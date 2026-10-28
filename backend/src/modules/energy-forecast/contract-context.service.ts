import {BadRequestException,ForbiddenException,Injectable,InternalServerErrorException,NotFoundException} from '@nestjs/common';
import {IsIn,IsOptional,IsString,IsUUID,Length,Matches} from 'class-validator';
import {SupabaseService} from '../../services/supabase.service';
import {LicensesService} from '../licenses/services/licenses.service';
import {OperationsService} from '../operations/operations.service';
import {TenantContext} from '../../common/interfaces/tenant-context.interface';
import {PERMISSIONS as P} from '../../common/constants/permissions';
import {validateWriteDto} from '../../common/validation/validate-write-dto';
import {decimal,quantity} from './consumption-forecast';
import {reportHash} from '../reports/report.projection';
import {calculateContractExposure,ContractTerm,ExposureScope,validateTerm} from './contract-exposure';

export class ContractContextDto {
 @IsUUID() requestId!:string; @IsUUID() customerId!:string; @IsUUID() unitId!:string;
 @IsString() @Length(1,100) contractId!:string;
 @IsIn(['REGULAR','SPOT','INTERRUPTED']) mode!:'REGULAR'|'SPOT'|'INTERRUPTED';
 @Matches(/^20\d{2}-\d{2}-\d{2}$/) from!:string; @Matches(/^20\d{2}-\d{2}-\d{2}$/) to!:string;
 @IsOptional() @IsIn(['MONTHLY_MWH','MW_AVERAGE']) basis?:'MONTHLY_MWH'|'MW_AVERAGE';
 @IsOptional() @Matches(/^(0|[1-9]\d{0,11})(\.\d{1,6})?$/) volume?:string;
 @IsOptional() @Matches(/^(0|[1-9]\d{0,3})(\.\d{1,6})?$/) minimumPercent?:string;
 @IsOptional() @Matches(/^(0|[1-9]\d{0,3})(\.\d{1,6})?$/) maximumPercent?:string;
 @IsUUID() documentId!:string;
 @IsString() @Length(3,160) source!:string;
 @IsString() @Length(20,1000) note!:string;
}
export const CONTRACT_CONTEXT_FORMAT='ENERGYOS_CONTRACT_CONTEXT_1';
@Injectable()
export class ContractContextService {
 constructor(private db:SupabaseService,private licenses:LicensesService,private operations:OperationsService){}
 private async allowed(t:TenantContext){
  if(!t.organizationId||!t.userId||(!['admin_org','gestor','operacional'].includes(t.role)&&t.accessMode!=='platform_operation')||!t.permissions?.includes(P.ORGANIZATION_CONTRACTS_VIEW)||!t.permissions?.includes(P.DOCUMENTS_REPORTS_VIEW)||!t.permissions.includes(P.OPERACAO_EVENTS_VIEW))throw new ForbiddenException('Consulta contratual exige permissões de contratos, relatórios e eventos no backoffice.');
  await this.licenses.requireEntitlement(t.organizationId,'free_market_management');await this.licenses.requireEntitlement(t.organizationId,'report_generation');
 }
 private async rows(query:any):Promise<any[]>{const r=await query.limit(201);if(r.error||!Array.isArray(r.data))throw new InternalServerErrorException('Fontes contratuais indisponíveis.');if(r.data.length>200)throw new BadRequestException('Fontes extensas; não foi usada uma seleção parcial.');return r.data;}
 private async context(scope:ExposureScope,t:TenantContext){
  await this.allowed(t);const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
  if(scope.organizationId!==t.organizationId||!uuid.test(scope.customerId)||!uuid.test(scope.unitId))throw new BadRequestException('Selecione empresa e unidade válidas.');
  const db=this.db.getClient(),u=await db.from('consumer_units').select('id').eq('organization_id',scope.organizationId).eq('customer_id',scope.customerId).eq('id',scope.unitId).eq('status','ACTIVE').maybeSingle();
  const customer=await db.from('customers').select('id').eq('organization_id',scope.organizationId).eq('id',scope.customerId).eq('status','ACTIVE').is('deleted_at',null).maybeSingle();
  if(u.error||customer.error)throw new InternalServerErrorException('Unidade indisponível.');if(!u.data||!customer.data)throw new NotFoundException('Unidade indisponível nesta empresa.');
  const [contracts,rules,events,contextIds]=await Promise.all([
   this.rows(db.from('energy_contracts').select('*').eq('organization_id',scope.organizationId).eq('customer_id',scope.customerId).eq('consumer_unit_id',scope.unitId).eq('contract_type','ENERGY_PURCHASE')),
   this.rows(db.from('supplier_billing_rules').select('*').eq('organization_id',scope.organizationId).eq('customer_id',scope.customerId).eq('consumer_unit_id',scope.unitId)),
   this.operations.list('events',t,{customerId:scope.customerId}),
   this.rows(db.from('operation_records').select('id').eq('organization_id',scope.organizationId).eq('customer_id',scope.customerId).eq('consumer_unit_id',scope.unitId).eq('kind','events').neq('status','ARCHIVED').like('table_text','%'+CONTRACT_CONTEXT_FORMAT+'%'))
  ]);
  return {contracts,rules,hiddenContext:contextIds.some(v=>!events.rows.some(e=>e.id===v.id)),events:events.rows.filter(v=>v.consumer_unit_id===scope.unitId&&v.status!=='ARCHIVED')};
 }
 async options(customerId:string,unitId:string,t:TenantContext){
  const scope={organizationId:t.organizationId,customerId,unitId},c=await this.context(scope,t);
  const documents=t.permissions.includes(P.DOCUMENTS_VIEW)?await this.rows(this.db.getClient().from('documents').select('id,original_filename,reference_month').eq('organization_id',scope.organizationId).eq('customer_id',customerId).eq('consumer_unit_id',unitId).eq('file_verified',true)):[];
  return {contracts:c.contracts.map(c=>({id:c.id,name:c.contract_number,status:c.status,from:c.start_date,to:c.end_date})),documents,events:c.events.filter(v=>{try{return JSON.parse(v.table_text??'{}').format===CONTRACT_CONTEXT_FORMAT;}catch{return false;}}).map(v=>({id:v.id,title:v.title,status:v.status,revision:v.revision})),canManage:t.permissions.includes(P.OPERACAO_EVENTS_MANAGE)&&t.permissions.includes(P.DOCUMENTS_REPORTS_CREATE)};
 }
 async save(input:unknown,t:TenantContext){
  const d=await validateWriteDto(ContractContextDto,input as ContractContextDto),scope={organizationId:t.organizationId,customerId:d.customerId,unitId:d.unitId},c=await this.context(scope,t);
  if(!t.permissions.includes(P.DOCUMENTS_REPORTS_CREATE))throw new ForbiddenException('Preparação de relatório necessária.');
  const contract=c.contracts.find(v=>v.id===d.contractId);if(!contract)throw new BadRequestException('Contrato fora da unidade selecionada.');
  if(d.mode==='REGULAR'&&(!['ACTIVE','APPROVED'].includes(contract.status)||d.from<String(contract.start_date).slice(0,10)||d.to>String(contract.end_date).slice(0,10)))throw new BadRequestException('A vigência deve estar contida no contrato regular ativo.');
  if(!t.permissions.includes(P.DOCUMENTS_VIEW))throw new ForbiddenException('Consulta do documento necessária.');await this.licenses.requireEntitlement(t.organizationId,'document_management');
  const doc=await this.db.getClient().from('documents').select('id,file_hash').eq('organization_id',scope.organizationId).eq('customer_id',scope.customerId).eq('consumer_unit_id',scope.unitId).eq('id',d.documentId).eq('file_verified',true).maybeSingle();
  if(doc.error||!doc.data?.file_hash)throw new BadRequestException('Documento recebido da mesma unidade necessário.');
  const term:ContractTerm={...scope,contractId:d.contractId,revision:'1',sourceHash:doc.data.file_hash,source:d.source.trim(),from:d.from,to:d.to,mode:d.mode,confirmed:false,...(d.mode==='REGULAR'?{basis:d.basis,volume:d.volume,minimumPercent:d.minimumPercent,maximumPercent:d.maximumPercent}:{})};
  try{validateTerm(term);}catch{throw new BadRequestException('Confira datas reais, volume, base e percentuais totais mínimo/máximo.');}
  return this.operations.save('events',null,{requestId:d.requestId,revision:0,reason:d.note,title:'Cobertura contratual · '+d.mode+' · '+d.from,description:d.note+' Fonte: '+d.source+'. Registro operacional para conferência; não comprova quebra contratual, obrigação jurídica ou pagamento.',priority:'NORMAL',customerId:d.customerId,unitId:d.unitId,responsibleId:t.userId,startsAt:d.from+'T12:00:00-03:00',documentId:d.documentId,tableText:JSON.stringify({format:CONTRACT_CONTEXT_FORMAT,term,contractHash:reportHash(contract)})},t);
 }
 async capture(scope:ExposureScope,future:{month:string;predictedKwh:string}[],at:string,t:TenantContext){
  if(!t.permissions.includes(P.OPERACAO_EVENTS_VIEW))return {...calculateContractExposure(scope,future,[],at,true),sources:[] as ContractTerm[]};
  return this.captureResolved(scope,future,at,await this.context(scope,t));
 }
 /** Same document/event ACL and interruption checks as planning; one source
  * capture per unit, not one database query per chart point. Read-only. */
 async marketSources(scope:ExposureScope,months:string[],t:TenantContext){
  if(!months.length||months.length>24||new Set(months).size!==months.length)throw new BadRequestException('Selecione até 24 competências.');
  const context=await this.context(scope,t),rows=[],terms:ContractTerm[]=[];const at=new Date().toISOString();
  for(let i=0;i<months.length;i+=12){const captured=await this.captureResolved(scope,months.slice(i,i+12).map(month=>({month,predictedKwh:'0'})),at,context);rows.push(...captured.rows);terms.push(...captured.sources);}
  return {contracts:context.contracts,rules:context.rules,coverage:rows,terms};
 }
 async capturePublishedPlanning(scope:ExposureScope,future:{month:string;predictedKwh:string}[],at:string,t:TenantContext){
  if(t.organizationId!==scope.organizationId||!t.userId||!t.roleId||t.role!=='consulta'||t.accessMode||!t.permissions?.includes(P.DOCUMENTS_REPORTS_VIEW))throw new ForbiddenException('Planejamento exige cliente vinculado.');
  await this.licenses.requireEntitlement(t.organizationId,'report_generation');await this.licenses.requireEntitlement(t.organizationId,'free_market_management');
  const gate=await this.db.getClient().rpc('energy_forecast_client_published',{p_org:t.organizationId,p_actor:t.userId,p_role:t.roleId});
  if(gate.error){if(gate.error.code==='42501')throw new ForbiddenException('Vínculo de planejamento revogado.');throw new InternalServerErrorException('Fontes de cobertura indisponíveis.');}
  if(gate.data?.customerId!==scope.customerId||!Array.isArray(gate.data.rows))throw new ForbiddenException('Consulta vinculada ao cliente necessária.');
    if(!gate.data.rows.some((r:any)=>r.organization_id===scope.organizationId&&r.customer_id===scope.customerId&&r.consumer_unit_id===scope.unitId&&r.publishedAt&&r.validatedAt)){
     const sources=await this.db.getClient().rpc('energy_forecast_client_sources',{p_org:t.organizationId,p_actor:t.userId,p_role:t.roleId});
     if(sources.error||sources.data?.customerId!==scope.customerId||!sources.data?.units?.some((u:any)=>u.organizationId===scope.organizationId&&u.customerId===scope.customerId&&u.unitId===scope.unitId&&u.publications?.length))throw new ForbiddenException('Fontes publicadas vinculadas necessárias.');
    }
  const db=this.db.getClient();
  const [contracts,rules,events]=await Promise.all([
   this.rows(db.from('energy_contracts').select('*').eq('organization_id',scope.organizationId).eq('customer_id',scope.customerId).eq('consumer_unit_id',scope.unitId).eq('contract_type','ENERGY_PURCHASE')),
   this.rows(db.from('supplier_billing_rules').select('*').eq('organization_id',scope.organizationId).eq('customer_id',scope.customerId).eq('consumer_unit_id',scope.unitId)),
   this.rows(db.from('operation_records').select('*').eq('organization_id',scope.organizationId).eq('customer_id',scope.customerId).eq('consumer_unit_id',scope.unitId).eq('kind','events').neq('status','ARCHIVED'))
  ]);
  return this.captureResolved(scope,future,at,{contracts,rules,events,hiddenContext:false});
 }
 private async captureResolved(scope:ExposureScope,future:{month:string;predictedKwh:string}[],at:string,c:{contracts:any[];rules:any[];events:any[];hiddenContext:boolean}){
  const terms:ContractTerm[]=[];let unavailable=c.hiddenContext;
  
  for(const e of c.events){let data:any;try{data=JSON.parse(e.table_text??'{}');}catch{if(String(e.table_text).includes(CONTRACT_CONTEXT_FORMAT))unavailable=true;continue;}
   if(data.format!==CONTRACT_CONTEXT_FORMAT)continue;
   const contract=c.contracts.find(v=>v.id===data.term?.contractId);
   if(!contract||data.contractHash!==reportHash(contract)){unavailable=true;continue;}
   const term={...data.term,revision:String(e.revision),confirmed:e.status==='PUBLISHED'} as ContractTerm;
   try{validateTerm(term);if(term.organizationId!==scope.organizationId||term.customerId!==scope.customerId||term.unitId!==scope.unitId)throw new Error();}catch{unavailable=true;continue;}
   const doc=await this.db.getClient().from('documents').select('file_hash').eq('organization_id',scope.organizationId).eq('customer_id',scope.customerId).eq('consumer_unit_id',scope.unitId).eq('id',e.document_id).eq('file_verified',true).maybeSingle();
   if(doc.error||doc.data?.file_hash!==term.sourceHash||(term.mode==='REGULAR'&&(!['ACTIVE','APPROVED'].includes(contract.status)||term.from<String(contract.start_date).slice(0,10)||term.to>String(contract.end_date).slice(0,10)))){unavailable=true;continue;}
   // No silent override: matching regular premises replace the registered rule only for their dates.
   terms.push(term);
  }
  for(const contract of c.contracts.filter(v=>['ACTIVE','APPROVED'].includes(v.status))){
   const rules=c.rules.filter(v=>v.contract_id===contract.id).sort((a,b)=>Number(b.version)-Number(a.version));
   for(const f of future){const month=f.month,first=month+'-01';
    if(terms.some(v=>v.contractId===contract.id&&v.mode==='REGULAR'&&v.from<=month+'-31'&&v.to>=first))continue;
    const rule=rules.find(v=>v.start_date<=month+'-31'&&v.end_date>=first);if(!rule)continue;
    const from=[String(contract.start_date).slice(0,10),String(rule.start_date).slice(0,10),first].sort().at(-1)!;
    const end=new Date(Date.UTC(Number(month.slice(0,4)),Number(month.slice(5)),0)).toISOString().slice(0,10),to=[String(contract.end_date).slice(0,10),String(rule.end_date).slice(0,10),end].sort()[0];if(from>to)continue;
    const term:ContractTerm={...scope,contractId:contract.id,revision:String(rule.version),sourceHash:reportHash({contract,rule}),source:'Condições de faturamento registradas · revisão '+rule.version,from,to,mode:rule.volume_basis==='SPOT'?'SPOT':'REGULAR',confirmed:true,basis:'MONTHLY_MWH',volume:String(contract.contracted_volume_mwh),minimumPercent:String(rule.min_percent),maximumPercent:rule.max_tolerance_percent===null?undefined:decimal(100000000n+quantity(String(rule.max_tolerance_percent)))};
    if(rule.volume_basis==='SEASONAL'){
     const season=(contract.seasonal_volumes??[]).find((v:any)=>String(v.year)===month.slice(0,4));
     if(!season){unavailable=true;continue;}term.basis='SEASONAL_MWH';term.volume=String(season.annualVolumeMwh);term.monthlyPercentages=season.monthlyPercentages.map(String);
    }else if(!['MONTHLY','SPOT'].includes(rule.volume_basis)){unavailable=true;continue;}
    try{validateTerm(term);terms.push(term);}catch{unavailable=true;}
   }
  }
  return {...calculateContractExposure(scope,future,terms,at,unavailable),sources:terms};
 }
}
