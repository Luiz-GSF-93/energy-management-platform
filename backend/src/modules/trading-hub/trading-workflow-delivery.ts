import {sendTradingMail,tradingMailConfigured,tradingMailFailure} from './trading-mail';
import {sendSms,smsReady} from '../sms-delivery/sms-delivery';
import {customerTemplateName} from '../whatsapp-delivery/whatsapp-template-selection';
import {TemplateSnapshot} from '../whatsapp-delivery/whatsapp-templates.service';
import {tradingEmailHtml} from './trading-email-template';
export function approvalNoticeHtml(title:string){return tradingEmailHtml({title:'Sua decisão sobre a proposta de energia',intro:'Uma proposta já conferida pela equipe de gestão está disponível para sua avaliação no Portal do Cliente.',facts:[['Solicitação e prazo',title]],actionLabel:'Conferir e responder no Portal',actionUrl:'https://app.expertenergy.com.br/portal#aprovacoes-trading',footer:'Confira as condições e o prazo antes de aprovar ou recusar. O vencimento não significa aprovação. A decisão deve ser registrada com seu acesso autorizado; este e-mail não assina um contrato.'});}
export async function sendWorkflowNotice(d:{id:string;channel:string;destination:string;title:string;href:string},templates?:TemplateSnapshot,transport:typeof fetch=fetch){
 const message=d.title+'. Consulte e registre sua decisão no Portal: https://app.expertenergy.com.br/portal#aprovacoes-trading';
 if(d.channel==='EMAIL'){
  if(!tradingMailConfigured())return{state:'FAILED',diagnostic:'TRADING_EMAIL_NOT_CONFIGURED'};
  try{return{state:'ACCEPTED',providerId:await sendTradingMail(d.destination,'EnergyOS — '+d.title,message,'trading-approval/'+d.id,approvalNoticeHtml(d.title))};}catch(e){const f=tradingMailFailure(e);return{state:f.state==='UNKNOWN'?'UNKNOWN':'FAILED',diagnostic:f.code};}
 }
 if(d.channel==='SMS'){if(!smsReady())return{state:'FAILED',diagnostic:'SMS_NOT_CONFIGURED'};const r=await sendSms(d.id,d.destination,message.slice(0,320),transport);return{...r,diagnostic:r.reason};}
 const template=customerTemplateName('energyos_proposta_urgente');
 if(d.channel!=='WHATSAPP'||!templates?.configured||!templates.rows.some(t=>t.name===template&&t.status==='APPROVED'&&t.parameterless)||!/^\+[1-9]\d{7,14}$/.test(d.destination))return{state:'FAILED',diagnostic:'WHATSAPP_TEMPLATE_OR_CONTACT_UNAVAILABLE'};
 try{const r=await transport(`https://graph.facebook.com/${process.env.WHATSAPP_GRAPH_VERSION}/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`,{method:'POST',redirect:'error',signal:AbortSignal.timeout(10000),headers:{Authorization:'Bearer '+process.env.WHATSAPP_ACCESS_TOKEN,'Content-Type':'application/json'},body:JSON.stringify({messaging_product:'whatsapp',to:d.destination.slice(1),type:'template',template:{name:template,language:{code:'pt_BR'}}})});
  if(!r.ok)return{state:r.status>=500||r.status===429?'UNKNOWN':'FAILED',diagnostic:'WHATSAPP_PROVIDER_REJECTED'};const b:any=await r.json();return typeof b.messages?.[0]?.id==='string'?{state:'ACCEPTED',providerId:b.messages[0].id}:{state:'UNKNOWN',diagnostic:'MISSING_RECEIPT'};
 }catch{return{state:'UNKNOWN',diagnostic:'NETWORK_UNCONFIRMED'};}
}
