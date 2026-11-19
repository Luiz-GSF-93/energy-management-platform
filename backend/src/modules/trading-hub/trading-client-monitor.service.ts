import {BadRequestException,ForbiddenException,Injectable,ServiceUnavailableException} from '@nestjs/common';
import {ConfigService} from '@nestjs/config';
import {SupabaseService} from '../../services/supabase.service';
import {TenantContext} from '../../common/interfaces/tenant-context.interface';
import {TradingHubService} from './trading-hub.service';
import {object,uuid} from './trading-validation';
import {digest,otp,otpDigest,randomToken,sendTradingMail,tradingMailConfigured,tradingMailFailure} from './trading-mail';
import {tradingEmailHtml} from './trading-email-template';
import {quotationMailBudget} from './trading-mail-budget';
import {clientMonitorSnapshot} from './trading-client-monitor.model';
@Injectable()
export class TradingClientMonitorService{
 constructor(private db:SupabaseService,private hub:TradingHubService,private config:ConfigService){}
 private enabled(){if(this.config.get('TRADING_CLIENT_MONITOR_ENABLED')!=='true')throw new ServiceUnavailableException('Acompanhamento do cliente em implantação.');}
 private secret(v:string){if(!/^[a-f0-9]{64}$/.test(v??''))throw new ForbiddenException('Link indisponível, revogado ou expirado.');return v;}
 private async rpc(name:string,args:any){let r:any;try{r=await this.db.createAuthClient().rpc(name,args).abortSignal(AbortSignal.timeout(10000));}catch{throw new ServiceUnavailableException('Consulta ou recebimento não confirmado. Confira o histórico antes de repetir.');}if(r.error){if(r.error.code==='42501')throw new ForbiddenException('Link, rodada ou acesso indisponível, revogado ou expirado.');if(['22023','22P02','PT409'].includes(r.error.code))throw new BadRequestException('Confira o prazo, o e-mail cadastrado do cliente e o histórico antes de repetir.');throw new ServiceUnavailableException('Consulta não confirmada. Atualize o acompanhamento antes de repetir.');}return r.data;}
 private exchange(action:string,body:any,t?:TenantContext,session?:string){return this.rpc('trading_client_monitor',{p_org:t?.organizationId??null,p_actor:t?.userId??null,p_session:session?digest(this.secret(session)):null,p_action:action,p_body:body});}
 async office(id:string,t:TenantContext,action:'LIST'|'PREVIEW'|'ISSUE'|'REVOKE',input?:unknown){this.enabled();uuid(id);await this.hub.allowed(t,['ISSUE','REVOKE'].includes(action));if(action==='ISSUE'&&(!tradingMailConfigured()||!quotationMailBudget()))throw new ServiceUnavailableException('O Owner deve configurar o remetente e os limites dos avisos de cotação antes de ativar o acesso.');const b=action==='PREVIEW'?this.scope(input):input===undefined?{}:object(input);const keys=Object.keys(b).sort().join(',');if(action==='ISSUE'&&(keys!=='expiresAt,requestId'||!Number.isFinite(Date.parse(b.expiresAt))))throw new BadRequestException('Informe o prazo de acesso.');if(action==='ISSUE')uuid(b.requestId);if(action==='REVOKE'){if(keys!=='id')throw new BadRequestException('Selecione o acesso.');uuid(b.id);}const result=await this.exchange(action,{...b,opportunityId:id},t);return action==='PREVIEW'?clientMonitorSnapshot(result):result;}
 private scope(input:unknown):Record<string,any>{const b=object(input??{});if(Object.keys(b).some(k=>!['unitId','year'].includes(k))||b.unitId!=null&&(typeof b.unitId!=='string'||!b.unitId||b.unitId.length>200)||b.year!=null&&!/^20[0-9]{2}$/.test(String(b.year)))throw new BadRequestException('Selecione a unidade e o ano desta cotação.');return {...(b.unitId?{unitId:b.unitId}:{}),...(b.year?{year:Number(b.year)}:{})};}
 async view(session:string,input?:unknown){this.enabled();const r=await this.exchange('VIEW',this.scope(input),undefined,session);return {...clientMonitorSnapshot(r),sessionExpiresAt:r.sessionExpiresAt};}
 async challenge(token:string){this.enabled();this.secret(token);if(!tradingMailConfigured())throw new ServiceUnavailableException('Envio do código indisponível.');const code=otp(),r=await this.rpc('trading_client_monitor_auth',{p_token:digest(token),p_action:'CHALLENGE',p_otp:otpDigest(token,code),p_session:null});if(!r.allowed)throw new BadRequestException('Aguarde um minuto ou confira o prazo.');await sendTradingMail(r.email,'EnergyOS — código para acompanhar a negociação',`Seu código é ${code}. Válido por até 10 minutos. Não compartilhe.`,'trading-monitor-otp/'+r.id+'/'+Date.now());return {sent:true};}
 async verify(token:string,input:unknown){this.enabled();this.secret(token);const b=object(input);if(Object.keys(b).join(',')!=='code'||!/^\d{6}$/.test(b.code??''))throw new BadRequestException('Informe o código de seis dígitos.');const session=randomToken(),r=await this.rpc('trading_client_monitor_auth',{p_token:digest(token),p_action:'VERIFY',p_otp:otpDigest(token,b.code),p_session:digest(session)});if(!r.allowed)throw new ForbiddenException('Código inválido, expirado ou limite atingido.');return {session};}
 async deliverOnce(){
  if(this.config.get('TRADING_CLIENT_MONITOR_ENABLED')!=='true'||!tradingMailConfigured())return;const b=quotationMailBudget();if(!b)return;
  const token=randomToken(),args={p_action:'CLAIM',p_id:null,p_token:digest(token),p_daily:b.daily,p_budget:b.budget,p_cost:b.costs.EMAIL,p_result:null};const d=await this.rpc('trading_client_monitor_mail',args);if(!d)return;
  const url='https://app.expertenergy.com.br/cotacao/acompanhamento#'+token;let result:any;
  try{const title='Acompanhe sua rodada de negociação',intro='Consulte preços, ranking e referências da sua rodada. Acesso somente de leitura, mediante código no seu e-mail e até o prazo indicado.';
   const providerId=await sendTradingMail(d.email,'EnergyOS — '+title,intro+'\n'+url,'trading-client-monitor/'+d.id,tradingEmailHtml({title,intro,actionUrl:url,actionLabel:'Acompanhar negociação',facts:[['Rodada',d.title],['Válido até',new Date(d.expiresAt).toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo'})]],footer:'O acesso não aprova propostas nem autoriza compras. Não encaminhe este link.'}));result={state:'ACCEPTED',providerId};
  }catch(e){const f=tradingMailFailure(e);result={state:f.state==='REJECTED'||f.state==='NOT_CONFIGURED'?'FAILED':'UNKNOWN',diagnostic:f.code};}
  await this.rpc('trading_client_monitor_mail',{...args,p_action:'FINISH',p_id:d.id,p_result:result});
 }
}
