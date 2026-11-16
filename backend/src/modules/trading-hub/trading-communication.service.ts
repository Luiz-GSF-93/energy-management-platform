import {BadRequestException,ConflictException,ForbiddenException,Injectable,ServiceUnavailableException} from '@nestjs/common';
import {ConfigService} from '@nestjs/config';
import {SupabaseService} from '../../services/supabase.service';
import {TenantContext} from '../../common/interfaces/tenant-context.interface';
import {TradingHubService} from './trading-hub.service';
import {object,text,uuid} from './trading-validation';
import {digest,otp,otpDigest,randomToken,sendTradingMail,tradingMailConfigured,tradingMailFailure} from './trading-mail';
import {tradingEmailHtml} from './trading-email-template';
import {portalDeliveryBudget} from '../portal-workspace/portal-notifications.worker';

export function communicationBody(input:unknown,office:boolean){
 const b=object(input),allowed=office?['invitationId','requestId','text','urgency','status']:['requestId','text','urgency'];
 if(Object.keys(b).some(k=>!allowed.includes(k))||![1,2,3].includes(b.urgency)||office&&!['WAITING_SUPPLIER','WAITING_BACKOFFICE','RESOLVED'].includes(b.status))throw new BadRequestException('Confira a mensagem, a urgência e o status da conversa.');
 uuid(b.requestId);if(office)uuid(b.invitationId);return {...b,text:text(b.text,3,2000)};
}
export const thanksText='Agradecemos sua participação nesta cotação. Infelizmente, sua proposta não apresentou o melhor preço nesta rodada. Contamos com sua participação nas próximas oportunidades: é muito importante tê-los em nossa rede de contatos. Obrigado pela atenção e pela parceria.';

@Injectable()
export class TradingCommunicationService{
 constructor(private db:SupabaseService,private hub:TradingHubService,private config:ConfigService){}
 private enabled(){if(this.config.get('TRADING_COMMUNICATIONS_ENABLED')!=='true')throw new ServiceUnavailableException('Conversas de cotação em implantação.');}
 private secret(value:string){if(!/^[a-f0-9]{64}$/.test(value??''))throw new ForbiddenException('Acesso inválido ou expirado.');return value;}
 private async rpc(name:string,args:any){const r=await this.db.createAuthClient().rpc(name,args);if(r.error){if(r.error.code==='42501')throw new ForbiddenException('A cotação, o contato ou seu acesso está indisponível ou expirou.');if(['PT409','40001','23505'].includes(r.error.code))throw new ConflictException('A cotação mudou. Confira o histórico antes de repetir.');if(['22023','23514'].includes(r.error.code))throw new BadRequestException('Confira os dados, o prazo e os destinatários. Aguarde antes de enviar outra mensagem.');throw new ServiceUnavailableException('Recebimento não confirmado. Consulte a conversa antes de repetir o envio.');}return r.data;}
 private exchange(action:string,body:any,actor?:TenantContext,session?:string){return this.rpc('trading_quote_exchange',{p_org:actor?.organizationId??null,p_actor:actor?.userId??null,p_session:session?digest(this.secret(session)):null,p_action:action,p_body:body});}
 async inbox(t:TenantContext,page=0){this.enabled();await this.hub.allowed(t);if(!Number.isInteger(page)||page<0||page>1000)throw new BadRequestException('Página inválida.');return this.exchange('BACKOFFICE_LIST',{page},t);}
 async tasks(t:TenantContext){this.enabled();await this.hub.allowed(t);return this.exchange('TASKS',{},t);}
 async message(t:TenantContext,input:unknown){this.enabled();await this.hub.allowed(t,true);return this.exchange('BACKOFFICE_MESSAGE',communicationBody(input,true),t);}
 async preview(t:TenantContext,proposal:string){this.enabled();await this.hub.allowed(t,true);uuid(proposal);return {...await this.exchange('THANKS_PREVIEW',{proposalId:proposal},t),text:thanksText};}
 async thanks(t:TenantContext,proposal:string,input:unknown){this.enabled();await this.hub.allowed(t,true);uuid(proposal);const b=object(input);if(Object.keys(b).sort().join(',')!=='confirmed,fingerprint,requestId'||b.confirmed!==true||!/^\w{32}$/.test(b.fingerprint??''))throw new BadRequestException('Confira e confirme os destinatários do agradecimento.');uuid(b.requestId);return this.exchange('THANKS_SEND',{...b,proposalId:proposal},t);}
 async supplierView(session:string){this.enabled();return this.exchange('SUPPLIER_LIST',{},undefined,session);}
 async supplierMessage(session:string,input:unknown){this.enabled();return this.exchange('SUPPLIER_MESSAGE',communicationBody(input,false),undefined,session);}
 async challenge(token:string){this.enabled();this.secret(token);const code=otp();const r=await this.rpc('trading_quote_access_auth',{p_token:digest(token),p_action:'CHALLENGE',p_otp:otpDigest(token,code),p_session:null});if(!r.allowed)throw new BadRequestException('Aguarde um minuto ou confira o prazo do link.');await sendTradingMail(r.email,'EnergyOS — código para consultar sua cotação',`Seu código é ${code}. Válido por até 10 minutos. Não compartilhe.`, 'trading-conversation-otp/'+r.id+'/'+Date.now());return {sent:true};}
 async verify(token:string,input:unknown){this.enabled();this.secret(token);const b=object(input);if(Object.keys(b).join(',')!=='code'||!/^\d{6}$/.test(b.code??''))throw new BadRequestException('Informe o código de seis dígitos.');const session=randomToken();const r=await this.rpc('trading_quote_access_auth',{p_token:digest(token),p_action:'VERIFY',p_otp:otpDigest(token,b.code),p_session:digest(session)});if(!r.allowed)throw new ForbiddenException('Código inválido, expirado ou limite de tentativas atingido.');return {session};}
 /** Reuses the existing scheduled Trading worker. One bounded delivery; never retries an uncertain provider result. */
 async deliverOnce(){
  if(this.config.get('TRADING_COMMUNICATIONS_ENABLED')!=='true')return;
  await this.rpc('expire_trading_quotes',{});
  if(!tradingMailConfigured())return;const budget=portalDeliveryBudget();if(!budget)return;
  const token=randomToken(),args={p_action:'CLAIM',p_id:null,p_lease:null,p_token:digest(token),p_daily:budget.daily,p_budget:budget.budget,p_costs:budget.costs,p_result:null};
  const d=await this.rpc('trading_quote_mail',args);if(!d)return;
  const started=await this.rpc('trading_quote_mail',{...args,p_action:'START',p_id:d.id,p_lease:d.lease});if(!started)return;
  const url='https://app.expertenergy.com.br/cotacao/conversas#'+token,isThanks=d.kind==='THANKS';let result:any;
  try{const title=isThanks?'Agradecemos sua participação':'Sua cotação tem uma atualização',intro=isThanks?thanksText:'O backoffice enviou uma pergunta, resposta ou comentário. Acesse a conversa da cotação pelo link atualizado. O acesso exige verificação pelo mesmo e-mail e respeita o prazo da cotação.';
   const providerId=await sendTradingMail(started.email,'EnergyOS — '+title,intro+'\n\nCotação: '+started.title+(isThanks?'':'\n'+url),'trading-quote-mail/'+d.id,tradingEmailHtml({title,intro,...(!isThanks?{actionUrl:url,actionLabel:'Consultar e responder'}:{}),facts:[['Cotação',started.title],['Organização',started.organization]],footer:'O aviso não altera propostas nem aprova contratos. Após o vencimento, os links e as ações da cotação deixam de estar disponíveis.'}));result={state:'ACCEPTED',providerId};
  }catch(e){const f=tradingMailFailure(e);result={state:f.state==='REJECTED'||f.state==='NOT_CONFIGURED'?'FAILED':'UNKNOWN',diagnostic:f.code};}
  await this.rpc('trading_quote_mail',{...args,p_action:'FINISH',p_id:d.id,p_lease:d.lease,p_result:result});
 }
}
