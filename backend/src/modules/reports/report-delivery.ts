import {smsReady,sendSms} from '../sms-delivery/sms-delivery';
export type ReportDeliveryResult={state:'ACCEPTED'|'FAILED'|'UNKNOWN';providerId?:string;reason?:string};
export type ReportAttachment={filename:string;content:string};
export function reportProviderReady(channel:string,env:NodeJS.ProcessEnv=process.env){
 if(channel==='email')return !!env.RESEND_API_KEY&&!!env.REPORTS_EMAIL_FROM&&/^[^\r\n]+@[^\r\n]+$/.test(env.REPORTS_EMAIL_FROM);
 if(channel==='whatsapp')return !!env.WHATSAPP_ACCESS_TOKEN&&/^\d+$/.test(env.WHATSAPP_PHONE_NUMBER_ID??'')&&/^v\d+\.\d+$/.test(env.WHATSAPP_GRAPH_VERSION??'')&&env.WHATSAPP_REPORT_TEMPLATE==='energyos_relatorio_disponivel'&&env.WHATSAPP_REPORT_TEMPLATE_APPROVED==='true';
 return channel==='sms'&&smsReady(env);
}
export async function sendReportDelivery(input:{id:string;channel:string;destination:string;attachments:ReportAttachment[]},transport:typeof fetch=fetch):Promise<ReportDeliveryResult>{
 if(!reportProviderReady(input.channel))return {state:'FAILED',reason:'PROVIDER_NOT_READY'};
 if(input.channel==='sms')return sendSms(input.id,input.destination,'EnergyOS: novos relatorios disponiveis. Acesse seu portal: https://app.expertenergy.com.br. Para alterar o recebimento, contate seu Consultor.',transport);
 if(input.channel==='email'&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.destination)||input.channel==='whatsapp'&&!/^\+[1-9]\d{7,14}$/.test(input.destination))return {state:'FAILED',reason:'INVALID_DESTINATION'};
 if(input.channel==='email'&&(!input.attachments.length||input.attachments.length>4||input.attachments.reduce((n,a)=>n+a.content.length,0)>12000000))return {state:'FAILED',reason:'ATTACHMENT_LIMIT'};
 try{
  const email=input.channel==='email';
  const response=await transport(email?'https://api.resend.com/emails':`https://graph.facebook.com/${process.env.WHATSAPP_GRAPH_VERSION}/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`,{method:'POST',redirect:'error',signal:AbortSignal.timeout(10000),headers:email?{Authorization:'Bearer '+process.env.RESEND_API_KEY,'Content-Type':'application/json','Idempotency-Key':'report-delivery/'+input.id}:{Authorization:'Bearer '+process.env.WHATSAPP_ACCESS_TOKEN,'Content-Type':'application/json'},body:JSON.stringify(email?{from:process.env.REPORTS_EMAIL_FROM,to:[input.destination],subject:'EnergyOS — relatórios disponíveis',text:'Os relatórios solicitados estão anexados. Este envio segue os contatos e canais configurados pela sua organização. Para alterar o recebimento, contate seu Consultor.',attachments:input.attachments}:{messaging_product:'whatsapp',to:input.destination.slice(1),type:'template',template:{name:'energyos_relatorio_disponivel',language:{code:'pt_BR'}}})});
  if(!response.ok)return response.status>=500||response.status===429?{state:'UNKNOWN',reason:'PROVIDER_UNCERTAIN'}:{state:'FAILED',reason:'PROVIDER_REJECTED'};
  const data=await response.json() as {id?:unknown;messages?:{id?:unknown}[]},id=email?data?.id:data?.messages?.[0]?.id;
  return typeof id==='string'&&id.length>0&&id.length<=512?{state:'ACCEPTED',providerId:id}:{state:'UNKNOWN',reason:'MISSING_RECEIPT'};
 }catch{return {state:'UNKNOWN',reason:'PROVIDER_UNCERTAIN'};}
}
