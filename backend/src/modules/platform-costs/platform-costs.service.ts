import {BadRequestException,ConflictException,Injectable,ServiceUnavailableException} from '@nestjs/common';
import {SupabaseService} from '../../services/supabase.service';
import {whatsappConfigured} from './cost-notifications';
import {monthlyProjection,brlMinor,budgetLevel} from './cost-math';
@Injectable()
export class PlatformCostsService {
 constructor(private db:SupabaseService){}
 async save(kind:'policy'|'infrastructure',definition:object,actor:string){
  const {data,error}=await this.db.getClient().rpc('save_platform_cost_setting',{p_kind:kind,p_definition:definition,p_actor:actor});
  if(error?.code==='P3151')throw new ConflictException('Configuração alterada. Atualize antes de salvar.');
  if(error?.code==='22023'||error?.code==='23514')throw new BadRequestException('Confira valores, câmbio e destinatários.');
  if(error||!data)throw new ServiceUnavailableException('Alteração de custos não confirmada.');
  return data;
 }
 async summary(requested?:string){
  const month=requested??new Date().toISOString().slice(0,7);
  if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(month))throw new BadRequestException('Informe a competência AAAA-MM.');
  const {data,error}=await this.db.getClient().rpc('platform_cost_snapshot',{p_month:month+'-01'});
  if(error||!data)throw new ServiceUnavailableException('Não foi possível carregar os custos completos.');
  const fx=data.policy.usd_brl_rate==null?null:Number(data.policy.usd_brl_rate);
  const estimated=Number(data.totals.actual_micro_usd??0),reserved=Number(data.totals.reserved_micro_usd??0),projection=monthlyProjection(estimated,month);
  const companies=(data.companies??[]).map((row:any)=>{
   const used=Number(row.actual_micro_usd??0),held=Number(row.reserved_micro_usd??0),quota=Number(row.quota_micro_usd??0);
   const direct=(data.infrastructure??[]).filter((c:any)=>c.organization_id===row.organization_id);
   const costs=direct.map((c:any)=>brlMinor(Number(c.amount_minor),c.currency,fx));
   const infra=costs.every((n:number|null)=>n!==null)?costs.reduce((a:number,b:number)=>a+b,0):null;
   const aiBrl=fx===null?null:Math.round(used*fx/10000);
   const revenue=row.monthly_price_brl_cents==null?null:Number(row.monthly_price_brl_cents);
   return {...row,actual_micro_usd:used,reserved_micro_usd:held,quota_micro_usd:quota,projection_micro_usd:monthlyProjection(used,month),level:budgetLevel(used+held,quota,monthlyProjection(used,month)),direct_infra_brl_cents:infra,ai_brl_cents:aiBrl,revenue_brl_cents:revenue,contribution_brl_cents:revenue!==null&&infra!==null&&aiBrl!==null?revenue-infra-aiBrl:null};
  });
  const expenses=(data.infrastructure??[]).map((c:any)=>brlMinor(Number(c.amount_minor),c.currency,fx));
  const infraBrl=expenses.every((n:number|null)=>n!==null)?expenses.reduce((a:number,b:number)=>a+b,0):null;
  const aiBrl=fx===null?(estimated===0?0:null):Math.round(estimated*fx/10000);
  const totalBrl=infraBrl!==null&&aiBrl!==null?infraBrl+aiBrl:null;
  const projectedBrl=infraBrl!==null&&fx!==null&&projection!==null?infraBrl+Math.round(projection*fx/10000):null;
  const globalQuota=Number(data.global_ceiling_micro_usd);
  return {...data,month,companies,total_cost_brl_cents:totalBrl,projected_cost_brl_cents:projectedBrl,infrastructure_brl_cents:infraBrl,total_cost_level:totalBrl!==null?budgetLevel(totalBrl,Number(data.policy.monthly_cost_limit_brl_cents??0),projectedBrl):null,projection_micro_usd:projection,level:budgetLevel(estimated+reserved,globalQuota,projection),timeBasis:'UTC',currencyBasis:'USD; conversão BRL somente com câmbio e data informados',costBasis:'Estimativa por preços configurados; faturamento do provedor prevalece',allocationBasis:'Custos diretamente atribuídos; infraestrutura compartilhada ainda não rateada. Margem de contribuição, não lucro líquido.',providers:{email:process.env.RESEND_API_KEY?'CONFIGURED':'NOT_CONFIGURED',ocr:'Azure Document Intelligence cobra por páginas; tokens OCR são apenas interpretação generativa.',frontend:'Métricas Vercel não conectadas',whatsapp:whatsappConfigured()?'CONFIGURED':'NOT_CONFIGURED'}};
 }
}
