export type Delivery='SENT'|'UNKNOWN';
export function whatsappConfigured(env:NodeJS.ProcessEnv=process.env){return !!env.WHATSAPP_ACCESS_TOKEN&&/^\d+$/.test(env.WHATSAPP_PHONE_NUMBER_ID??'')&&/^v\d+\.\d+$/.test(env.WHATSAPP_GRAPH_VERSION??'')&&/^[a-z0-9_]+$/.test(env.WHATSAPP_ALERT_TEMPLATE??'');}
export async function sendCostAlert(alert:{id:string;channel:string;message:string},policy:{email:string;whatsapp:string},transport:typeof fetch=fetch):Promise<Delivery>{
 try{
  let response:Response;
  if(alert.channel==='email'){
   if(!process.env.RESEND_API_KEY||!policy.email)return 'UNKNOWN';
   response=await transport('https://api.resend.com/emails',{method:'POST',redirect:'error',signal:AbortSignal.timeout(10000),headers:{Authorization:'Bearer '+process.env.RESEND_API_KEY,'Content-Type':'application/json','Idempotency-Key':'platform-cost/'+alert.id},body:JSON.stringify({from:process.env.MEMBERSHIP_EMAIL_FROM||'Expert Energy <nao-responda@notificacoes.expertenergy.com.br>',to:[policy.email],subject:'EnergyOS — alerta de custo e performance',text:alert.message+'\n\nConfira o Painel Administrativo de Custos e Performance da Plataforma. Valores de IA são estimativas, sem aprovação de gasto adicional.'})});
   if(!response.ok)return 'UNKNOWN';const data=await response.json() as any;return typeof data.id==='string'?'SENT':'UNKNOWN';
  }
  if(!whatsappConfigured()||!/^\+[1-9]\d{7,14}$/.test(policy.whatsapp))return 'UNKNOWN';
  response=await transport(`https://graph.facebook.com/${process.env.WHATSAPP_GRAPH_VERSION}/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`,{method:'POST',redirect:'error',signal:AbortSignal.timeout(10000),headers:{Authorization:'Bearer '+process.env.WHATSAPP_ACCESS_TOKEN,'Content-Type':'application/json'},body:JSON.stringify({messaging_product:'whatsapp',to:policy.whatsapp.slice(1),type:'template',template:{name:process.env.WHATSAPP_ALERT_TEMPLATE,language:{code:'pt_BR'},components:[{type:'body',parameters:[{type:'text',text:alert.message.slice(0,1000)}]}]}})});
  if(!response.ok)return 'UNKNOWN';const data=await response.json() as any;return typeof data.messages?.[0]?.id==='string'?'SENT':'UNKNOWN';
 }catch{return 'UNKNOWN';}
}
