import {BadRequestException,ForbiddenException,Injectable,ServiceUnavailableException} from '@nestjs/common';
import {SupabaseService} from '../../services/supabase.service';
import {TenantContext} from '../../common/interfaces/tenant-context.interface';
import {CceeDataService} from './ccee-data.service';
import {CceeService} from './ccee.service';
import {cceeObject,cceeText,cceeUuid} from './ccee-data.model';
import {marketDay,marketDigest,marketQuery,marketTrend,markets,serviceCatalogue} from './ccee-market.model';
@Injectable()
export class CceeMarketService{
 constructor(private db:SupabaseService,private data:CceeDataService,private ccee:CceeService){}
 private async rpc(name:string,args:Record<string,unknown>){const r=await this.db.getClient().rpc(name,args);if(r.error){if(r.error.code==='42501')throw new ForbiddenException('Reconferir licença, permissão e vínculo CCEE.');if(['22023','22P02','23502','23514'].includes(r.error.code))throw new BadRequestException('Confira filtros, medidor, orçamento e estado da homologação.');if(r.error.code==='40001')throw new BadRequestException('Consulta em andamento ou revisão alterada. Confira o histórico.');throw new ServiceUnavailableException('Histórico CCEE indisponível; fontes existentes foram preservadas.');}return r.data;}
 async read(t:TenantContext,input:Record<string,unknown>){
  const q=marketQuery(input),workspace=await this.data.workspace(t),result=await this.rpc('ccee_market_read',{p_org:t.organizationId,p_actor:t.userId,p_query:q});
  if(result?.organizationId!==t.organizationId||!Array.isArray(result.rows)||!Array.isArray(result.series)||!Array.isArray(result.dailyHistory)||!Array.isArray(result.schedules))throw new ServiceUnavailableException('Escopo do histórico alterado.');
  const trends=markets.filter(m=>q.submarkets.includes(m)).map(submarket=>({submarket,...marketTrend(result.dailyHistory.filter((d:any)=>d.submarket===submarket).map((d:any)=>({day:d.day,value:Number(d.value).toFixed(6),hours:Number(d.hours)})))}));
  const catalogue=serviceCatalogue.map(s=>{const schedules=result.schedules.filter((v:any)=>v.kind===s.key),job=result.latestJobs?.find((j:any)=>j.kind===(s.key==='PLD_HOURLY'?'PLD':s.key));return {...s,state:!s.implemented?'IMPLEMENTATION_REQUIRED':schedules.some((v:any)=>v.homologated)?'HOMOLOGATED':job?.state==='SUCCEEDED'?'SOURCE_AVAILABLE':job?.state==='FAILED'?'PROVIDER_REVIEW_REQUIRED':'HOMOLOGATION_REQUIRED'};});
  const bindings=workspace.bindings??[];
  return {...result,dailyHistory:undefined,trends,catalogue,sourceFingerprint:marketDigest({series:result.series,trends}),canManage:workspace.canManage,bindings:bindings.filter((b:any)=>b.status==='APPROVED'&&b.service_scope?.includes('MEASUREMENTS')&&!bindings.some((n:any)=>n.consumer_unit_id===b.consumer_unit_id&&n.revision>b.revision)).map((b:any)=>({id:b.id,customerId:b.customer_id,unitId:b.consumer_unit_id,meter:b.meter_code,principalProfile:b.principal_profile_code,revision:b.revision})),connection:this.ccee.status(),workerEnabled:process.env.CCEE_MARKET_SYNC_ENABLED==='true',privateEnabled:process.env.CCEE_MARKET_FIVE_MINUTE_ENABLED==='true',homologationMode:process.env.CCEE_MARKET_HOMOLOGATION_MODE!=='false',frequencySeconds:3600,checkedAt:new Date().toISOString(),notice:'Dados oficiais coletados, fontes mensais publicadas e análises estimadas são identificados separadamente. Atualização da fonte depende da disponibilização pela CCEE.'};
 }
 async schedule(t:TenantContext,id:string|null,input:unknown){
  const ws=await this.data.workspace(t);if(!ws.canManage)throw new ForbiddenException('Gestão CCEE necessária.');
  const b=cceeObject(input,['action','reason'],['requestId','kind','authorizationId','maxRequests','dailyLimit','dayOffset','day','enabled']);cceeText(b.reason,1000);if(id)cceeUuid(id);
  if(b.action==='configure'){if(id||!['PLD_HOURLY','MEASUREMENTS_5M'].includes(b.kind))throw new BadRequestException('Serviço inválido.');cceeUuid(b.requestId);if(b.kind==='MEASUREMENTS_5M')cceeUuid(b.authorizationId);else if(b.authorizationId)throw new BadRequestException('PLD não exige vínculo privado.');if(!Number.isInteger(b.maxRequests)||b.maxRequests<2||b.maxRequests>10||!Number.isInteger(b.dailyLimit)||b.dailyLimit<2||b.dailyLimit>1000||!Number.isInteger(b.dayOffset)||b.dayOffset< -3||b.dayOffset>0)throw new BadRequestException('Configure limites por consulta e por dia.');}
  else if(b.action==='collect'){if(!id)throw new BadRequestException('Selecione a configuração.');marketDay(b.day);}
  else if(b.action==='toggle'){if(!id||typeof b.enabled!=='boolean')throw new BadRequestException('Ativação inválida.');}
  else throw new BadRequestException('Ação inválida.');
  return this.rpc('ccee_market_schedule',{p_org:t.organizationId,p_actor:t.userId,p_id:id,p_body:b});
 }
 async measurements(t:TenantContext,input:Record<string,unknown>){await this.data.workspace(t);if(Object.keys(input).some(k=>!['authorizationId','from','to','page'].includes(k)))throw new BadRequestException('Filtro de medição inválido.');const id=cceeUuid(input.authorizationId),from=marketDay(input.from),to=marketDay(input.to),page=Number(input.page??0);if(from>to||Date.parse(to)-Date.parse(from)>7*86400000||!Number.isInteger(page)||page<0||page>10000)throw new BadRequestException('Consulte até oito dias por vez.');return this.rpc('ccee_market_measurements',{p_org:t.organizationId,p_actor:t.userId,p_binding:id,p_from:from,p_to:to,p_page:page});}
}
