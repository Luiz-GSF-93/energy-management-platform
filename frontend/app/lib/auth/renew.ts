import {session,tokenClaims} from './session';
let pending: Promise<string> | null=null;
export function sessionAttention(message:string) { if(typeof window!=='undefined') window.dispatchEvent(new CustomEvent('session-attention',{detail:message})); }
export async function freshToken(force=false):Promise<string> {
 const token=session.getAccessToken();
 if(!token) throw new Error('Entre novamente para continuar.');
 if(session.getExpectedUser() && tokenClaims(token).sub!==session.getExpectedUser()) {
  sessionAttention('A conta foi alterada em outra aba. Entre novamente com a mesma conta para preservar o contexto.');
  throw new Error('A conta mudou em outra aba. Renove o acesso antes de continuar.');
 }
 const exp=tokenClaims(token).exp||0;
 if(!force && exp*1000>Date.now()+120000) return token;
 if(pending)return pending;
 const run=async()=>{
  const current=session.getAccessToken();
  if(tokenClaims(current).sub!==tokenClaims(token).sub)throw new Error('A conta mudou em outra aba. Entre novamente com a mesma conta.');
  if(current!==token && current && (tokenClaims(current).exp||0)*1000>Date.now()+120000) return current;
  const refresh=window.localStorage.getItem('refresh_token');
  if(!refresh){sessionAttention('Sua sessão precisa ser renovada. Entre novamente abaixo; mantenha esta página aberta para preservar o formulário.');if(!force && exp*1000>Date.now()+5000)return token;throw new Error('Entre novamente no aviso acima para habilitar a renovação automática.');}
  const response=await fetch((process.env.NEXT_PUBLIC_API_URL||'').replace(/\/+$/,'')+'/api/v1/auth/refresh',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({refresh_token:refresh}),signal:AbortSignal.timeout(15000)});
  if(!response.ok)throw new Error(response.status===401?'Sessão expirada. Entre novamente no aviso acima.':'Não foi possível renovar a sessão. Verifique sua conexão e tente novamente.');
  const result=await response.json();
  if(typeof result.access_token!=='string'||typeof result.refresh_token!=='string'||tokenClaims(result.access_token).sub!==tokenClaims(token).sub)throw new Error('Resposta de renovação inválida.');
  if(session.getAccessToken()!==current)throw new Error('A sessão mudou em outra aba. Confira o usuário antes de continuar.');
  session.setTokens(result);return result.access_token;
 };
 // Serialize rotating refresh tokens across tabs, as well as concurrent requests.
 pending=(navigator.locks?navigator.locks.request('energy-session-refresh',run):run()).catch(e=>{sessionAttention(e.message);throw e;}).finally(()=>{pending=null;});
 return pending;
}
