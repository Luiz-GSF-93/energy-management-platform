import {createHash,createHmac,timingSafeEqual} from 'node:crypto';
export const TEAM_TEMPLATE='84f37309-be6f-4c5f-aed2-499d562124cb';
export const TEAM_FROM='EnergyOS <nao-responda@notificacoes.expertenergy.com.br>';
export const TEAM_SUBJECT='Seu acesso à equipe da plataforma — EnergyOS';
const profiles:Record<string,[string,string]>={
 OWNER:['Owner','Administração completa da plataforma, planos, licenças, equipe, gastos e integrações, conforme controles e auditoria. Até dois Owners ativos.'],
 ADMINISTRATOR:['Administrador','Cadastro e consulta de organizações e atendimento autorizado. Sem gestão de planos, licenças, perfis globais ou credenciais.'],
 FINANCE:['Financeiro','Consulta financeira, consumo e gastos autorizados; preparação de conciliações versionadas com evidência para conferência pelo Owner. Sem gestão de perfis, planos, licenças, credenciais ou execução financeira externa.'],
 SUPPORT:['Suporte','Consulta técnica e atendimento somente nos chamados atribuídos, conforme permissões. Sem acesso financeiro, concessão de perfis ou administração de credenciais.'],
};
export const escapeHtml=(s:string)=>s.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
export function teamVariables(row:any){
 const profile=profiles[row.profile],name=row.display_name,date=new Date(row.validated_at);
 if(!profile||typeof name!=='string'||!name.trim()||name.length>201||!Number.isFinite(date.getTime())||typeof row.recipient!=='string'||row.recipient.length>254||!/^\S+@[^\s@]+\.[^\s@]+$/.test(row.recipient)||/[\r\n]/.test(row.recipient))throw Error('INVALID_PAYLOAD');
 return {NOME_USUARIO:escapeHtml(name),PERFIL:profile[0],ATRIBUICOES:profile[1],DATA_VALIDACAO:date.toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo'})};
}
export function templateSnapshot(t:any,expectedVersion:string,expectedHash:string,variables:Record<string,string>){
 if(!expectedVersion||!/^[0-9a-f]{64}$/.test(expectedHash)||t?.id!==TEAM_TEMPLATE||t.status!=='published'||t.current_version_id!==expectedVersion||typeof t.html!=='string'||t.html.length>100000||t.from!==TEAM_FROM||t.subject!==TEAM_SUBJECT)throw Error('TEMPLATE_UNCONFIRMED');
 const hash=createHash('sha256').update(t.html).digest('hex');
 if(hash!==expectedHash)throw Error('TEMPLATE_CHANGED');
 const source:string=t.html;
 const keys=Array.from(source.matchAll(/\{\{\{([A-Z_]+)\}\}\}/g),m=>m[1]);
 if(Object.keys(variables).some(k=>!keys.includes(k))||keys.some(k=>!(k in variables)))throw Error('TEMPLATE_VARIABLES');
 const html=t.html.replace(/\{\{\{([A-Z_]+)\}\}\}/g,(_m:string,k:string)=>variables[k]);
 if(/\{\{|\}\}/.test(html))throw Error('TEMPLATE_VARIABLES');
 return {html,hash,version:expectedVersion};
}
export function verifyTeamWebhook(raw:Buffer,headers:Record<string,unknown>,secret:string,now=Date.now()){
 const id=headers['svix-id'],timestamp=headers['svix-timestamp'],signature=headers['svix-signature'];
 if(!Buffer.isBuffer(raw)||raw.length>65536||typeof id!=='string'||!/^msg_[A-Za-z0-9]+$/.test(id)||id.length>150||typeof timestamp!=='string'||!/^\d{10}$/.test(timestamp)||Math.abs(now/1000-Number(timestamp))>300||typeof signature!=='string'||signature.length>2000||!/^whsec_[A-Za-z0-9+/=]+$/.test(secret))throw Error('INVALID_WEBHOOK');
 const key=Buffer.from(secret.slice(6),'base64'); if(key.length<16)throw Error('INVALID_WEBHOOK');
 const digest=createHmac('sha256',key).update(id+'.'+timestamp+'.').update(raw).digest();
 const valid=signature.split(' ').some(s=>{const [v,b64]=s.split(',');if(v!=='v1'||!b64)return false;const candidate=Buffer.from(b64,'base64');return candidate.length===digest.length&&timingSafeEqual(candidate,digest)});
 if(!valid)throw Error('INVALID_WEBHOOK');
 const body=JSON.parse(raw.toString('utf8'));
 const map:Record<string,string>={'email.sent':'ACCEPTED','email.delivered':'DELIVERED','email.delivery_delayed':'DELAYED','email.failed':'FAILED','email.suppressed':'FAILED','email.bounced':'BOUNCED','email.complained':'COMPLAINED'};
 const state=map[body?.type]; if(!state)return {ignored:true as const};
 const provider=body?.data?.email_id,at=body?.created_at;
 if(typeof provider!=='string'||!/^[0-9a-f-]{36}$/.test(provider)||typeof at!=='string'||!Number.isFinite(Date.parse(at))||Date.parse(at)>now+300000)throw Error('INVALID_WEBHOOK');
 let correlation:{notification:string;recipient:string;from:string;subject:string}|null=null;
 if(body.data?.tags?.flow==='platform-team'){
  const notification=body.data.tags.notification,to=body.data.to,from=body.data.from,subject=body.data.subject;
  if(typeof notification!=='string'||!/^[0-9a-f-]{36}$/.test(notification)||!Array.isArray(to)||to.length!==1||typeof to[0]!=='string'||to[0].length>254||![TEAM_FROM,'nao-responda@notificacoes.expertenergy.com.br'].includes(from)||subject!==TEAM_SUBJECT)throw Error('INVALID_WEBHOOK');
  correlation={notification,recipient:to[0].toLowerCase(),from:TEAM_FROM,subject};
 }
 return {id,provider,state,at,correlation};
}
