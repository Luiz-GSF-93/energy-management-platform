import {createHash,createHmac,randomBytes,randomInt} from 'crypto';
import {ServiceUnavailableException} from '@nestjs/common';
export const digest=(value:string|Buffer)=>createHash('sha256').update(value).digest('hex');
export const randomToken=()=>randomBytes(32).toString('hex');
export const otp=()=>String(randomInt(0,1000000)).padStart(6,'0');
export function otpDigest(token:string,code:string){const secret=process.env.TRADING_PORTAL_SECRET??process.env.SUPABASE_SERVICE_KEY;if(!secret)throw new ServiceUnavailableException('Configuração segura do portal indisponível.');const derived=createHmac('sha256',secret).update('energyos-trading-otp-v1').digest();return createHmac('sha256',derived).update(token+':'+code).digest('hex');}
export const escapeHtml=(s:string)=>s.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
export function tradingMailConfigured(){return !!process.env.RESEND_API_KEY&&!!process.env.TRADING_EMAIL_FROM&&/^[^\s@]+@cotacoes\.expertenergy\.com\.br$/.test(process.env.TRADING_EMAIL_FROM);}
export async function sendTradingMail(email:string,subject:string,text:string,key:string,html?:string){
 if(!tradingMailConfigured())throw new ServiceUnavailableException('Verifique cotacoes.expertenergy.com.br no Resend e configure TRADING_EMAIL_FROM.');
 const response=await fetch('https://api.resend.com/emails',{method:'POST',redirect:'error',signal:AbortSignal.timeout(15000),headers:{Authorization:'Bearer '+process.env.RESEND_API_KEY,'Content-Type':'application/json','Idempotency-Key':key},body:JSON.stringify({from:`EnergyOS | Expert Energy <${process.env.TRADING_EMAIL_FROM}>`,to:[email],subject,text,...(html?{html}:{})})});
 if(!response.ok)throw new ServiceUnavailableException('Resend não confirmou o envio. Consulte o histórico antes de repetir.');const result:any=await response.json();if(typeof result.id!=='string')throw new ServiceUnavailableException('Envio sem confirmação.');return result.id;
}
