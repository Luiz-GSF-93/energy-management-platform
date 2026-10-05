import {Injectable, ServiceUnavailableException} from '@nestjs/common';
import {SupabaseService} from '../../services/supabase.service';

export type AiUsage={inputTokens:number;outputTokens:number};
// Prices must be verified against the Azure offer used by this subscription.
// USD per million tokens equals micro-USD per token. No public OpenAI-price fallback.
export function usageCost(usage:AiUsage,inputPrice:number,outputPrice:number){
 if(!Number.isSafeInteger(usage.inputTokens)||!Number.isSafeInteger(usage.outputTokens)||usage.inputTokens<0||usage.outputTokens<0||!Number.isFinite(inputPrice)||!Number.isFinite(outputPrice)||inputPrice<=0||outputPrice<0)throw new Error('INVALID_AI_COST');
 const cost=Math.ceil(usage.inputTokens*inputPrice+usage.outputTokens*outputPrice);
 if(!Number.isSafeInteger(cost)||cost<=0)throw new Error('INVALID_AI_COST');
 return cost;
}
@Injectable()
export class BotEnergyBudgetService {
 constructor(private db:SupabaseService){}
 private prices(kind:'conversation'|'embeddings'){
  const prefix=kind==='conversation'?'BOT_ENERGY_AZURE_CHAT':'BOT_ENERGY_AZURE_EMBEDDING';
  if(!process.env[prefix+'_INPUT_USD_PER_MILLION']?.trim()||kind==='conversation'&&!process.env[prefix+'_OUTPUT_USD_PER_MILLION']?.trim())throw new ServiceUnavailableException('Preços Azure ainda não verificados. Nenhuma chamada de IA foi iniciada.');
  const input=Number(process.env[prefix+'_INPUT_USD_PER_MILLION']);
  const output=kind==='embeddings'?0:Number(process.env[prefix+'_OUTPUT_USD_PER_MILLION']);
  if(process.env.BOT_ENERGY_AZURE_PRICES_VERIFIED!=='true'||!Number.isFinite(input)||input<=0||!Number.isFinite(output)||output<0)throw new ServiceUnavailableException('Preços Azure ainda não verificados. Nenhuma chamada de IA foi iniciada.');
  return {input,output};
 }
 async reserve(org:string,actor:string,id:string,kind:'conversation'|'embeddings',maximum:AiUsage){
  const prices=this.prices(kind),reserved=usageCost(maximum,prices.input,prices.output);
  const {data,error}=await this.db.getClient().rpc('reserve_bot_energy_ai_usage',{p_id:id,p_organization:org,p_actor:actor,p_kind:kind,p_reserved_micro_usd:reserved});
  if(error||data!==true)throw new ServiceUnavailableException('Limite mensal da IA atingido ou controle de consumo indisponível.');
  return {id,org,prices,reserved};
 }
 async settle(reservation:Awaited<ReturnType<BotEnergyBudgetService['reserve']>>,usage:AiUsage){
  const actual=usageCost(usage,reservation.prices.input,reservation.prices.output);
  const {data,error}=await this.db.getClient().rpc('settle_bot_energy_ai_usage',{p_id:reservation.id,p_organization:reservation.org,p_actual_micro_usd:actual,p_input_tokens:usage.inputTokens,p_output_tokens:usage.outputTokens});
  if(error||data!==true)throw new ServiceUnavailableException('Consumo pendente de conciliação. A reserva permanece contabilizada.');
 }
}
