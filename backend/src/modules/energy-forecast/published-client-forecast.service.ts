import {automaticPlanning} from './automatic-planning';
import {publicationPlanning} from './publication-planning';
import {normalizePublishedDetail} from '../portal-insights/portal-legacy-detail';
import {ContractContextService} from './contract-context.service';
import {calculateContractExposure} from './contract-exposure';
import {ForbiddenException,Injectable,InternalServerErrorException,Optional} from '@nestjs/common';
import {ConfigService} from '@nestjs/config';
import {SupabaseService} from '../../services/supabase.service';
import {LicensesService} from '../licenses/services/licenses.service';
import {TenantContext} from '../../common/interfaces/tenant-context.interface';
import {PERMISSIONS as P} from '../../common/constants/permissions';
import {reportHash} from '../reports/report.projection';
import {publicContractExposure} from './contract-exposure';
import {climateCycleSummary} from './climate-summary';

@Injectable()
export class PublishedClientForecastService {
 constructor(private db:SupabaseService,private licenses:LicensesService,private config:ConfigService,@Optional() private contractContext?:ContractContextService){}
 private async current(row:any,customerId:string,t:TenantContext,reads:Map<number,Promise<any>>,sources?:any){
  const unavailable=(message:string)=>({forecastId:row.id,unitName:row.unitName,state:'SOURCE_PENDING',notice:message});
  try{
   const b=row.body,calculatedAt=new Date().toISOString(),first=b.actual?.[0]?.month,year=Math.max(Number(b.asOfMonth.slice(0,4)),Number(new Intl.DateTimeFormat('en',{timeZone:'America/Sao_Paulo',year:'numeric'}).format(new Date(calculatedAt))));
   if(!sources&&(typeof first!=='string'||year-Number(first.slice(0,4))>3))return unavailable('Histórico publicado antigo: a equipe deve conferir a continuidade antes de atualizar a previsão.');
   const publications:any[]=sources?sources.publications.map((p:any)=>normalizePublishedDetail(p,t.organizationId)):[];
   for(let y=sources?year+1:Number(first.slice(0,4));y<=year;y++){
    if(!reads.has(y))reads.set(y,Promise.resolve(this.db.getClient().rpc('read_portal_financial_components_v2',{p_org:t.organizationId,p_actor:t.userId,p_role:t.roleId,p_platform:false,p_portal:true,p_from:y+'-01',p_to:y+'-12',p_customer:customerId})));
    const result=await reads.get(y)!;
    if(result.error?.code==='42501')throw new ForbiddenException('Vínculo de acesso revogado durante a atualização.');
    if(result.error||!Array.isArray(result.data)||result.data.some((p:any)=>p.customerId!==customerId||typeof p.month!=='string'||p.month<y+'-01'||p.month>y+'-12'))return unavailable('A atualização das medições publicadas está indisponível. A previsão preservada continua abaixo.');
    publications.push(...result.data.filter((p:any)=>p.unitId===row.consumer_unit_id&&p.month>=first).map((p:any)=>normalizePublishedDetail(p,t.organizationId)));
   }
   const scope={organizationId:t.organizationId,customerId,unitId:row.consumer_unit_id};
   const plan=sources?automaticPlanning(scope,sources,publications,calculatedAt,row.synthetic?undefined:b,row.request?.weather):publicationPlanning(b,publications,calculatedAt,row.request?.weather);
   if(plan.state!=='AVAILABLE')return {...unavailable(plan.pending.join(' ')),pending:plan.pending};
   const c=plan.current;
   let exposure;
   try{exposure=this.contractContext?await this.contractContext.capturePublishedPlanning(scope,c.future,calculatedAt,t):calculateContractExposure(scope,c.future,[],calculatedAt,true);}catch(e){if(e instanceof ForbiddenException)throw e;exposure=calculateContractExposure(scope,c.future,[],calculatedAt,true);}
   return {forecastId:row.id,state:'AVAILABLE',calculatedAt,sourceFingerprint:reportHash({planning:plan.sourceFingerprint,contractSources:(exposure as any).sources??[],rows:exposure.rows}),sourceMonths:c.actual.map((p:any)=>p.month),sourceOrigins:'origins' in plan?plan.origins:undefined,unitName:row.unitName,notice:'Planejamento estimado atualizado automaticamente: prioridade para CCEE final completa; na ausência, consumo publicado e histórico documentado da fatura. Não altera fechamentos ou a previsão histórica preservada.',forecast:{id:row.id,version:row.version,unitId:row.consumer_unit_id,unitName:row.unitName,asOfMonth:c.asOfMonth,publishedAt:row.publishedAt,formulaVersion:c.formulaVersion,method:c.method,weatherStatus:c.weatherStatus,climateSummary:climateCycleSummary(c.climateAssessment),contractExposure:publicContractExposure(exposure),contractingScenario:c.contractingScenario,actual:c.actual.map((a:any)=>({month:a.month,consumptionKwh:a.consumptionKwh})),future:c.future.map((a:any)=>({month:a.month,predictedKwh:a.predictedKwh,expansionKwh:a.expansionKwh,averageBasis:a.averageBasis})),observedYearKwh:c.observedYearKwh,futureKwh:c.futureKwh,estimatedYearKwh:c.estimatedYearKwh}};
  }catch(e){if(e instanceof ForbiddenException)throw e;return unavailable('A equipe deve conferir a continuidade, os dias de leitura e a conciliação das fontes antes de atualizar o planejamento. A previsão histórica foi preservada.');}
 }
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
    formulaVersion:b.formulaVersion,method:b.method,weatherStatus:b.weatherStatus,climateSummary:climateCycleSummary(b.climateAssessment),contractExposure:publicContractExposure(b.contractExposure),
    actual:b.actual.map((a:any)=>({month:a.month,consumptionKwh:a.consumptionKwh})),
    future:b.future.map((a:any)=>({month:a.month,predictedKwh:a.predictedKwh,expansionKwh:a.expansionKwh,averageBasis:a.averageBasis})),
    observedYearKwh:b.observedYearKwh,futureKwh:b.futureKwh,estimatedYearKwh:b.estimatedYearKwh};
  });
  if(this.config.get('PORTAL_DYNAMIC_PLANNING_ENABLED')==='false')return {rows};
  const sourceResult=await this.db.getClient().rpc('energy_forecast_client_sources',{p_org:t.organizationId,p_actor:t.userId,p_role:t.roleId});
  if(sourceResult.error?.code==='42501')throw new ForbiddenException('Vínculo de planejamento revogado.');
  if(sourceResult.error||sourceResult.data?.customerId!==data.customerId||!Array.isArray(sourceResult.data?.units))throw new InternalServerErrorException('Não foi possível conferir as fontes do planejamento.');
  const unitSources=new Map<string,any>();
  for(const source of sourceResult.data.units){
   if(source.organizationId!==t.organizationId||source.customerId!==data.customerId||typeof source.unitId!=='string'||unitSources.has(source.unitId)||!Array.isArray(source.publications)||source.publications.some((p:any)=>p.customerId!==data.customerId||p.unitId!==source.unitId))throw new InternalServerErrorException('Integridade das fontes de planejamento indisponível.');
   unitSources.set(source.unitId,source);
  }
  const currentPlanning=[],latest=new Map<string,any>(),reads=new Map<number,Promise<any>>();
  // One current plan per unit; older forecasts remain available unchanged.
  // Annual reads are shared only within this authorized response, never across users.
  for(const row of data.rows){const old=latest.get(row.consumer_unit_id);if(!old||row.cutoff>old.cutoff||row.cutoff===old.cutoff&&row.version>old.version)latest.set(row.consumer_unit_id,row);}
  for(const source of unitSources.values())if(!latest.has(source.unitId)){const cutoff=source.publications.map((p:any)=>p.month).sort().at(-1);if(cutoff)latest.set(source.unitId,{id:'planning:'+source.unitId,consumer_unit_id:source.unitId,unitName:source.unitName,synthetic:true,body:{asOfMonth:cutoff},cutoff});}
  const selected=[...latest.values()];
  for(let i=0;i<selected.length;i+=4)currentPlanning.push(...await Promise.all(selected.slice(i,i+4).map(row=>this.current(row,data.customerId,t,reads,unitSources.get(row.consumer_unit_id)))));
  return {rows,currentPlanning};
 }
}
