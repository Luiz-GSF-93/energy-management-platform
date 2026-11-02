import {createHash,createHmac,randomBytes,randomInt} from 'crypto';
import {ServiceUnavailableException} from '@nestjs/common';
export const digest=(value:string|Buffer)=>createHash('sha256').update(value).digest('hex');
export const randomToken=()=>randomBytes(32).toString('hex');
export const otp=()=>String(randomInt(0,1000000)).padStart(6,'0');
export function otpDigest(token:string,code:string){const secret=process.env.TRADING_PORTAL_SECRET??process.env.SUPABASE_SERVICE_KEY;if(!secret)throw new ServiceUnavailableException('Configuração segura do portal indisponível.');const derived=createHmac('sha256',secret).update('energyos-trading-otp-v1').digest();return createHmac('sha256',derived).update(token+':'+code).digest('hex');}
export const escapeHtml=(s:string)=>s.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
export function tradingMailConfigured(){return !!process.env.TRADING_RESEND_API_KEY?.trim()&&!!process.env.TRADING_EMAIL_FROM&&/^[^\s@]+@cotacoes\.expertenergy\.com\.br$/.test(process.env.TRADING_EMAIL_FROM);}
export class TradingMailError extends ServiceUnavailableException {
 constructor(readonly outcome:'REJECTED'|'UNKNOWN'|'NOT_CONFIGURED',readonly diagnosticCode:string,readonly httpStatus:number|null=null){super(outcome==='NOT_CONFIGURED'?'Configure TRADING_RESEND_API_KEY e o remetente exclusivo de cotações.':outcome==='REJECTED'?`Envio recusado pelo provedor (${httpStatus}). Confira a configuração do remetente.`:'Resultado do envio não confirmado. Consulte o provedor antes de reenviar.');}
}
export function tradingMailFailure(error:unknown){return error instanceof TradingMailError?{state:error.outcome,httpStatus:error.httpStatus,code:error.diagnosticCode}:{state:'UNKNOWN' as const,httpStatus:null,code:'RESULT_UNCONFIRMED'};}
export async function sendTradingMail(email:string,subject:string,text:string,key:string,html?:string){
 if(!tradingMailConfigured())throw new TradingMailError('NOT_CONFIGURED','TRADING_MAIL_NOT_CONFIGURED');
 let response:Response;
 try{response=await fetch('https://api.resend.com/emails',{method:'POST',redirect:'error',signal:AbortSignal.timeout(15000),headers:{Authorization:'Bearer '+process.env.TRADING_RESEND_API_KEY,'Content-Type':'application/json','Idempotency-Key':key},body:JSON.stringify({from:`EnergyOS | Expert Energy <${process.env.TRADING_EMAIL_FROM}>`,to:[email],subject,text,...(html?{html}:{})})});}
 catch{throw new TradingMailError('UNKNOWN','NETWORK_UNCONFIRMED');}
 if(!response.ok){
  let code='HTTP_'+response.status;
  if(response.status===403){try{const body:any=await response.json();if(typeof body.message==='string'&&body.message.includes('API key not authorized for this domain'))code='SENDER_DOMAIN_NOT_ALLOWED';}catch{/* Never retain provider bodies or credentials. */}}
  throw new TradingMailError([400,401,403,404,413,422].includes(response.status)?'REJECTED':'UNKNOWN',code,response.status);
 }
 try{const result:any=await response.json();if(typeof result.id==='string'&&result.id.length>0)return result.id;}catch{/* A success without an id remains uncertain. */}
 throw new TradingMailError('UNKNOWN','MISSING_PROVIDER_ID',response.status);
}
