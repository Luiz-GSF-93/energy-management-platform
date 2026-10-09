import {ConfigService} from '@nestjs/config';
import {PublishedClientForecastService} from '../energy-forecast/published-client-forecast.service';
import {Injectable,BadRequestException,ForbiddenException,ConflictException,InternalServerErrorException} from '@nestjs/common';
import {TenantContext} from '../../common/interfaces/tenant-context.interface';
import {PERMISSIONS as P} from '../../common/constants/permissions';
import {SupabaseService} from '../../services/supabase.service';
import {ReportsService} from '../reports/reports.service';
import {FinancialSettlementsService} from '../contracts/services/financial-settlements.service';
import {BotEnergyLicenseService} from '../ocr/bot-energy-license.service';
import {BotEnergyRagService} from '../ocr/bot-energy-rag.service';
import {questionEvidence,questionRegulation,questionMonths,questionText} from '../ocr/bot-energy-question';
import {reportEvidence} from './report-evidence';
import {clientReportAnalytics} from './client-report-sources';
import {ReportAiService} from './report-ai.service';
const uuid=(s:unknown):s is string=>typeof s==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(s);
export function reportPeriod(from:unknown,to:unknown){
 const valid=(s:unknown):s is string=>typeof s==='string'&&/^20\d{2}-(0[1-9]|1[0-2])$/.test(s);
 if(!valid(from)||!valid(to)||from>to||(Number(to.slice(0,4))-Number(from.slice(0,4)))*12+Number(to.slice(5))-Number(from.slice(5))>=12)throw new BadRequestException('Informe um período válido de até 12 meses.');
 return {from,to};
}
@Injectable()
export class BotReportsService {
 constructor(private db:SupabaseService,private reports:ReportsService,private financial:FinancialSettlementsService,private licenses:BotEnergyLicenseService,private rag:BotEnergyRagService,private ai:ReportAiService,private clientForecast:PublishedClientForecastService,private config:ConfigService){}
 private async permission(t:TenantContext,audience:'client'|'backoffice'){
  if(!t.organizationId||!t.userId||(t.scope as string)==='global'||!t.permissions?.includes(P.DOCUMENTS_REPORTS_VIEW)||!t.permissions.includes(P.INTELLIGENCE_AI_USE)||(audience==='client'?(t.role!=='consulta'||!!t.accessMode||!t.roleId):(!['operacional','gestor','admin_org'].includes(t.role)&&t.accessMode!=='platform_operation')))throw new ForbiddenException('Bot-Energy exige acesso de relatórios e IA no contexto autorizado.');
  if(!await this.licenses.available(t.organizationId))throw new ForbiddenException('Bot-Energy exige licença vigente e cota disponível.');
 }
 private async client(t:TenantContext,period:{from:string;to:string},unit?:string){
  const r=await this.db.getClient().rpc('bot_energy_client_reports',{p_org:t.organizationId,p_actor:t.userId,p_role:t.roleId,p_from:period.from,p_to:period.to,p_unit:unit??null});
  if(r.error){if(r.error.code==='42501')throw new ForbiddenException('Vínculo ou permissão atual indisponível.');throw new InternalServerErrorException('Fontes publicadas indisponíveis.');}
  if(!r.data?.customerId||!Array.isArray(r.data.units))throw new InternalServerErrorException('Contexto do cliente indisponível.');
  return r.data;
 }
 async clientUnits(from:unknown,to:unknown,t:TenantContext){await this.permission(t,'client');const period=reportPeriod(from,to),data=await this.client(t,period);return {units:data.units.map((u:any)=>({id:u.id,name:u.name})),period};}
 async ask(input:any,t:TenantContext,audience:'client'|'backoffice'){
  await this.permission(t,audience);
  const keys=audience==='client'?['question','unitId','from','to','kind']:['question','reportId','kind'];
  if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(k=>!keys.includes(k))||typeof input.question!=='string'||!input.question.trim()||input.question.length>500||!['OPERATIONAL','EXECUTIVE','FINANCIAL'].includes(input.kind))throw new BadRequestException('Selecione o contexto e informe uma pergunta de até 500 caracteres.');
  let analytics:any,scope:any,forecast:any=null;
  if(audience==='client'){
   if(!uuid(input.unitId))throw new BadRequestException('Selecione uma unidade vinculada.');
   const period=reportPeriod(input.from,input.to),data=await this.client(t,period,input.unitId);
   analytics=clientReportAnalytics(data,t.organizationId,period,input.unitId);
   if(this.config.get('ENERGY_FORECAST_ENABLED')==='true'){const published=await this.clientForecast.list(t);forecast=published.rows.filter((f:any)=>f.unitId===input.unitId&&f.asOfMonth<=period.to).sort((a:any,b:any)=>b.asOfMonth.localeCompare(a.asOfMonth)||b.version-a.version)[0]??null;}
   scope={unitId:input.unitId,unitName:data.units.find((u:any)=>u.id===input.unitId)?.name,audience};
  }else{
   if(!uuid(input.reportId))throw new BadRequestException('Abra uma versão de relatório.');
   const report=await this.reports.one(input.reportId,t),b=report.body;
   const result=await this.financial.reports({from:b.period.from,to:b.period.to,customerId:b.header.customerId,unitId:b.header.unitId},t);
   const matches=b.publications.length===result.primary.publications.length&&b.publications.every((p:any)=>result.primary.publications.some((r:any)=>p.id===r.id&&p.payloadHash===r.payloadHash&&p.version===r.version));
   if(!matches)throw new ConflictException('Há publicação mais recente que a versão aberta. Gere ou abra um relatório com as fontes atuais antes de perguntar ao Bot.');
   analytics=result.primary;scope={unitId:b.header.unitId,unitName:b.header.unitName,audience};forecast=b.annualProjection;
  }
  const period=analytics.period,months=questionMonths(input.question),q=questionText(input.question);
  const years=[...q.matchAll(/\b(20\d{2})\b/g)].map(m=>m[1]);
  if(months.length>2||(months.length===1&&(period.from!==months[0]||period.to!==months[0]))||(months.length===2&&(period.from!==[...months].sort()[0]||period.to!==[...months].sort()[1]))||years.some(y=>!months.length&&(period.from!==y+'-01'||period.to!==y+'-12'))||months.some(m=>m<period.from||m>period.to)||years.some(y=>y<period.from.slice(0,4)||y>period.to.slice(0,4))||/ultim[oa]s?\s+\d+|\bdias?\b/.test(q))return {state:'CONTEXT_REQUIRED',message:'A pergunta indica outro recorte. Selecione ou gere o relatório no intervalo mensal desejado. Este contexto não contém medições diárias; o Bot não presume outro período.'};
  if(/\bpaga[s]?\b|\bpago[s]?\b|pagamento|quitad/.test(q))return {state:'NO_EVIDENCE',message:'Este contexto contém custos apurados publicados, sem comprovação de pagamento. Para informar valores pagos, é necessário um registro de quitação vinculado à fatura.'};
  const evidence=reportEvidence(analytics,scope,forecast);
  if(/como|onde|preencher|utilizar|usar/.test(q)&&/relatorio|portal|previsao|publica|fonte/.test(q))evidence.push({id:'product-guide-reports',label:'Guia do produto · relatórios · versão 1',value:audience==='client'?'No portal, consulte Financeiro publicado e Previsão de consumo. No Bot, selecione unidade, período e visão. Confira as fontes da resposta. Apenas resultados publicados ficam disponíveis; peça esclarecimentos à equipe de gestão.':'Relatórios: consulte as publicações, selecione cliente e unidade, gere uma versão e abra-a. No Bot da versão aberta, pergunte sobre resultados e fontes. Previsão de consumo possui conferência de dados e premissas, justificativa, validação e publicação separadas; validação não publica automaticamente. PDF e Excel preservam a versão gerada.',source:'Guia de uso do EnergyOS; não é norma regulatória'});
  if(questionRegulation(input.question)){
   const end=new Date(Date.UTC(Number(period.to.slice(0,4)),Number(period.to.slice(5)),0)).toISOString().slice(0,10),query={periodStart:period.from+'-01',periodEnd:end,market:'ACL' as const};
   const official=audience==='client'?await this.rag.retrieveClient(t,input.question,query,scope.unitId):await this.rag.retrieve(t,input.question,query);
   if(official.state!=='READY')return {state:'NO_EVIDENCE',message:'A biblioteca oficial ainda não possui evidência revisada e vigente suficiente para esta pergunta. Trechos em rascunho não são usados como regra. Os valores publicados continuam disponíveis para consulta.'};
   evidence.push(...official.evidence);
  }
  const answer=await this.ai.interpret(t,input.question,questionEvidence(input.question,evidence),audience);
  return {...answer,context:{unitName:scope.unitName,period,kind:input.kind},checkedAt:new Date().toISOString()};
 }
}
