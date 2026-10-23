import {BadRequestException,Controller,ForbiddenException,Get,Header,Injectable,Post,Body,ServiceUnavailableException} from '@nestjs/common';
import {SupabaseService} from '../../services/supabase.service';
import {TenantContext} from '../../common/interfaces/tenant-context.interface';
import {Tenant} from '../../common/decorators/tenant.decorator';
import {PERMISSIONS as P} from '../../common/constants/permissions';
import {LicensesService} from '../licenses/services/licenses.service';
import {ContractContextService} from '../energy-forecast/contract-context.service';
import {ContractIndexMemoryService} from '../contracts/services/contract-index-memory.service';
import {CceeMarketService} from './ccee-market.service';
import {COMPARISON_VERSION,comparisonQuery,unitContractComparison,weightedComparison} from './ccee-contract-comparison.model';
import {marketDigest} from './ccee-market.model';

@Injectable()
export class CceeContractComparisonService {
 constructor(private db:SupabaseService,private market:CceeMarketService,private licenses:LicensesService,private context:ContractContextService,private memories:ContractIndexMemoryService){}
 private async allowed(t:TenantContext){
  if(!t?.organizationId||!t.userId||(!['admin_org','gestor','operacional'].includes(t.role)&&t.accessMode!=='platform_operation')||![P.ORGANIZATION_CONTRACTS_VIEW,P.ORGANIZATION_CUSTOMERS_VIEW,P.ORGANIZATION_CONSUMER_UNITS_VIEW,P.DOCUMENTS_REPORTS_VIEW,P.OPERACAO_EVENTS_VIEW].every(p=>t.permissions?.includes(p)))throw new ForbiddenException('Comparação exige acesso interno a empresas, unidades, contratos, relatórios e eventos.');
  await this.licenses.requireEntitlement(t.organizationId,'free_market_management');
  await this.licenses.requireEntitlement(t.organizationId,'report_generation');
 }
 private async rows(q:any,limit=2000):Promise<any[]>{const r=await q.limit(limit+1);if(r.error||!Array.isArray(r.data))throw new ServiceUnavailableException('Fontes da comparação indisponíveis.');if(r.data.length>limit)throw new BadRequestException('Reduza o recorte; fontes incompletas não serão comparadas.');return r.data;}
 async options(t:TenantContext){
  await this.allowed(t);await this.market.read(t,{from:'2026-01-01',to:'2026-01-01'});
  const db=this.db.getClient(),[companies,units]=await Promise.all([
   this.rows(db.from('customers').select('id,company_name').eq('organization_id',t.organizationId).is('deleted_at',null).eq('status','ACTIVE').order('company_name')),
   this.rows(db.from('consumer_units').select('id,customer_id,name,code,free_market,organization_id').eq('organization_id',t.organizationId).eq('status','ACTIVE').order('name'))]);
  return {organizationId:t.organizationId,companies:companies.map(c=>({id:c.id,name:c.company_name})),units:units.filter(u=>companies.some(c=>c.id===u.customer_id)).map(u=>({id:u.id,customerId:u.customer_id,name:u.name,code:u.code})),maxUnits:20,maxMonths:24};
 }
 async compare(t:TenantContext,input:unknown){
  await this.allowed(t);const q=comparisonQuery(input),db=this.db.getClient();
  const end=new Date(Date.UTC(Number(q.to.slice(0,4)),Number(q.to.slice(5)),0)).toISOString().slice(0,10);
  const market=await this.market.read(t,{from:q.from+'-01',to:end,granularity:'MONTH',origin:'ALL',page:'0'});
  const ids=q.selection.map(s=>s.unitId),[units,companies]=await Promise.all([
   this.rows(db.from('consumer_units').select('*').eq('organization_id',t.organizationId).in('id',ids).eq('status','ACTIVE'),20),
   this.rows(db.from('customers').select('id,company_name').eq('organization_id',t.organizationId).in('id',[...new Set(q.selection.map(s=>s.customerId))]).is('deleted_at',null).eq('status','ACTIVE'),20)]);
  // Validate the entire selection before capturing any private contract source.
  if(units.length!==ids.length||q.selection.some(s=>!units.some(u=>u.id===s.unitId&&u.customer_id===s.customerId&&u.organization_id===t.organizationId)||!companies.some(c=>c.id===s.customerId)))throw new ForbiddenException('Empresa ou unidade fora do escopo autorizado.');
  const contexts:Awaited<ReturnType<ContractContextService['marketSources']>>[]=[];for(const s of q.selection)contexts.push(await this.context.marketSources({organizationId:t.organizationId,...s},q.months,t));
  const contracts=contexts.flatMap(c=>c.contracts);if(contracts.length>100)throw new BadRequestException('Reduza o recorte de contratos.');
  const prices=contracts.length?await this.rows(db.from('contract_price_history').select('*').in('contract_id',contracts.map(c=>c.id)).gte('end_date',q.from+'-01').lte('start_date',end)):[];
  const memories:any[]=[];for(const c of contracts.filter(c=>c.pricing_mode!=='FIXED')){
   const h=await this.memories.history({contractId:c.id},t);if(h.enabled){if(h.rows.length>=100)throw new BadRequestException('Histórico de reajuste extenso; confira um recorte menor.');memories.push(...h.rows);}
  }
  const documentIds=[...new Set(memories.map(m=>m.source_document?.id).filter(Boolean))];
  const documents=documentIds.length?await this.rows(db.from('documents').select('id,organization_id,customer_id,consumer_unit_id,energy_contract_id,file_verified,file_hash,original_filename').eq('organization_id',t.organizationId).in('id',documentIds).eq('file_verified',true)):[];
  const rows=q.selection.flatMap((s,i)=>q.months.map(month=>unitContractComparison(units.find(u=>u.id===s.unitId),month,contexts[i],prices,memories,documents,market.series)));
  const groups=companies.map(c=>({customerId:c.id,name:c.company_name,unitIds:q.selection.filter(s=>s.customerId===c.id).map(s=>s.unitId),months:q.months.map(month=>({month,...weightedComparison(rows.filter(r=>r.customerId===c.id&&r.month===month),q.selection.filter(s=>s.customerId===c.id).length)}))}));
  return {organizationId:t.organizationId,version:COMPARISON_VERSION,from:q.from,to:q.to,rows,companies:groups,units:q.selection.map(s=>({id:s.unitId,customerId:s.customerId,name:units.find(u=>u.id===s.unitId).name})),portfolio:q.months.map(month=>({month,...weightedComparison(rows.filter(r=>r.month===month),ids.length)})),marketSeries:market.series,sourceFingerprint:marketDigest({rows,market:market.sourceFingerprint}),calculatedAt:new Date().toISOString(),notice:'TE do contrato vigente por competência; não é preço médio da NF. PLD +5%, +10% e +15% são cenários estimados. Comparação nominal, com bases fiscais identificadas; não altera fechamentos.'};
 }
 async analyze(t:TenantContext,input:any){
  if(!input||typeof input!=='object'||typeof input.sourceFingerprint!=='string')throw new BadRequestException('Atualize a comparação antes da análise.');
  const {sourceFingerprint,...query}=input,current=await this.compare(t,query);if(sourceFingerprint!==current.sourceFingerprint)throw new BadRequestException('As fontes mudaram. Atualize a comparação antes da análise.');
  return {...current,analysis:current.companies.map(company=>({customerId:company.customerId,name:company.name,units:current.units.filter(u=>u.customerId===company.customerId).map(unit=>{
   const rows=current.rows.filter(r=>r.unitId===unit.id),valid=rows.filter(r=>r.price!==null),last=valid.at(-1),delta=last?.scenarios.find((s:any)=>s.key==='PLD');
   return {unitId:unit.id,name:unit.name,covered:valid.length,total:rows.length,latestMonth:last?.month??null,text:last?`Eu, EVA, identifiquei TE contratada de R$ ${Number(last.price).toFixed(2)}/MWh em ${last.month}. ${delta?.percent!=null?'A diferença nominal frente ao PLD do submercado é '+Number(delta.percent).toFixed(2)+'%.':'Não há PLD comparável nesta competência.'} Confira os cenários de +5%, +10% e +15%, a vigência e os tributos antes de negociar.`:'Eu, EVA, não identifiquei TE regular vigente comprovada neste recorte. Confira os períodos avulsos, o reajuste e as fontes indicadas na tabela.',reviews:rows.filter(r=>r.state!=='AVAILABLE').map(r=>({month:r.month,state:r.state,notice:r.notice}))};
  })})),analysisNotice:'Análise determinística da EVA, com fórmulas e fontes desta comparação. Não usa IA paga, não presume causalidade nem executa compras. Documentação de contexto pode ser consultada no painel EVA de movimentos de preços.'};
 }
}
@Controller('ccee-market/contracts')
export class CceeContractComparisonController {
 constructor(private service:CceeContractComparisonService){}
 @Get('options') @Header('Cache-Control','private, no-store') options(@Tenant()t:TenantContext){return this.service.options(t);}
 @Post('compare') @Header('Cache-Control','private, no-store') compare(@Tenant()t:TenantContext,@Body()b:unknown){return this.service.compare(t,b);}
 @Post('analyze') @Header('Cache-Control','private, no-store') analyze(@Tenant()t:TenantContext,@Body()b:unknown){return this.service.analyze(t,b);}
}
