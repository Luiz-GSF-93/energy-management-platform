import {customerTemplateName} from '../whatsapp-delivery/whatsapp-template-selection';
import {sendSms,smsReady} from '../sms-delivery/sms-delivery';
import {reportProviderReady,ReportDeliveryResult} from '../reports/report-delivery';
import {TemplateSnapshot} from '../whatsapp-delivery/whatsapp-templates.service';
export const noticeTemplates:Record<string,string>={REQUEST:'energyos_solicitacao_cliente',AGENDA:'energyos_lembrete_prazo',DEADLINE:'energyos_lembrete_prazo',ACL_PUBLISHED:'energyos_adesao_atualizada'};
export const noticeTexts:Record<string,string>={REQUEST:'EnergyOS: ha uma solicitacao atualizada para sua unidade.',AGENDA:'EnergyOS: sua agenda foi atualizada.',DEADLINE:'EnergyOS: ha um prazo nas proximas 24 horas.',ACL_PUBLISHED:'EnergyOS: o resultado aprovado da adesao ACL esta disponivel.'};
export function noticeReady(channel:string,event:string,templates?:TemplateSnapshot){
 if(!noticeTexts[event])return false;
 if(channel==='email')return reportProviderReady('email');if(channel==='sms')return smsReady();
 return channel==='whatsapp'&&!!process.env.WHATSAPP_ACCESS_TOKEN&&/^\d+$/.test(process.env.WHATSAPP_PHONE_NUMBER_ID??'')&&/^v\d+\.\d+$/.test(process.env.WHATSAPP_GRAPH_VERSION??'')&&!!templates?.rows.some(t=>t.name===customerTemplateName(noticeTemplates[event])&&t.status==='APPROVED'&&t.parameterless===true);
}
export async function sendCustomerNotice(d:{id:string;channel:string;event:string;destination:string},templates?:TemplateSnapshot,transport:typeof fetch=fetch):Promise<ReportDeliveryResult>{
 if(!noticeReady(d.channel,d.event,templates))return {state:'FAILED',reason:'PROVIDER_NOT_READY'};
 const text=noticeTexts[d.event]+' Acesse https://app.expertenergy.com.br. Para alterar o recebimento, contate seu Consultor.';
 if(d.channel==='sms')return sendSms(d.id,d.destination,text,transport);
 const email=d.channel==='email';
 if(!(email?/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(d.destination):/^\+[1-9]\d{7,14}$/.test(d.destination)))return {state:'FAILED',reason:'INVALID_DESTINATION'};
 try{
  const response=await transport(email?'https://api.resend.com/emails':`https://graph.facebook.com/${process.env.WHATSAPP_GRAPH_VERSION}/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`,{method:'POST',redirect:'error',signal:AbortSignal.timeout(10000),headers:email?{Authorization:'Bearer '+process.env.RESEND_API_KEY,'Content-Type':'application/json','Idempotency-Key':'customer-notice/'+d.id}:{Authorization:'Bearer '+process.env.WHATSAPP_ACCESS_TOKEN,'Content-Type':'application/json'},body:JSON.stringify(email?{from:process.env.REPORTS_EMAIL_FROM,to:[d.destination],subject:'EnergyOS — aviso da sua unidade',text}:{messaging_product:'whatsapp',to:d.destination.slice(1),type:'template',template:{name:customerTemplateName(noticeTemplates[d.event]),language:{code:'pt_BR'}}})});
  if(!response.ok)return response.status>=500||response.status===429?{state:'UNKNOWN',reason:'PROVIDER_UNCERTAIN'}:{state:'FAILED',reason:'PROVIDER_REJECTED'};
  const body=await response.json() as {id?:string;messages?:{id?:string}[]},id=email?body.id:body.messages?.[0]?.id;return typeof id==='string'&&id.length>0&&id.length<=512?{state:'ACCEPTED',providerId:id}:{state:'UNKNOWN',reason:'MISSING_RECEIPT'};
 }catch{return {state:'UNKNOWN',reason:'PROVIDER_UNCERTAIN'};}
}
