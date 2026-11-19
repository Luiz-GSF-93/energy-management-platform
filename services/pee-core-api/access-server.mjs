import {brandMarkup,brandCss,embeddedFonts} from './brand.mjs';
import http from 'node:http';
import {createHash,randomBytes} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {AccessFailure,createCoreTransport,equalSecret,identifier,opaque,token} from './core-transport.mjs';
import {createSealer} from './session-seal.mjs';
import {createApplication} from './application.mjs';
import {ProjectError} from './project-policy.mjs';
import {StoreError} from './store.mjs';

const SESSION='__Host-pee_session',STATE='__Host-pee_state';
const digest=value=>createHash('sha256').update(value).digest('base64url');
const escape=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const deny=(status,message)=>{throw new AccessFailure(status,message);};
const exact=(x,keys)=>x&&typeof x==='object'&&!Array.isArray(x)&&Object.keys(x).length===keys.length&&keys.every(k=>Object.hasOwn(x,k));
const httpsOrigin=value=>{const u=new URL(value);if(u.protocol!=='https:'||u.username||u.password||u.pathname!=='/'||u.search||u.hash)throw Error('HTTPS origin required');return u.origin;};
function cookies(req){const result={};for(const pair of (req.headers.cookie??'').split(';')){const i=pair.indexOf('=');if(i>0){const name=pair.slice(0,i).trim();if(Object.hasOwn(result,name))deny(401,'Sessão inválida');result[name]=pair.slice(i+1).trim();}}return result;}
function cookie(name,value,seconds){return `${name}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${seconds}`;}
async function jsonBody(req,max=16384){if(!/^application\/json(?:;|$)/i.test(req.headers['content-type']??''))deny(415,'Use JSON');let bytes=0;const chunks=[];for await(const chunk of req){bytes+=chunk.length;if(bytes>max)deny(413,'Solicitação excede o limite');chunks.push(chunk);}try{return JSON.parse(Buffer.concat(chunks).toString()||'{}');}catch{deny(400,'JSON inválido');}}

export function accessConfiguration(env=process.env){
 if(env.PEE_ACCESS_ENABLED!=='true')return null;
 if(env.PEE_CORE_ENABLED==='true')throw Error('Access mode must not enable the incompatible reference licensing gateway');
 const config={publicOrigin:httpsOrigin(env.PEE_PUBLIC_ORIGIN??''),coreOrigin:httpsOrigin(env.CORE_PUBLIC_ORIGIN??''),organization:env.CORE_OWNER_ORGANIZATION_ID,tenant:env.CORE_WORKSPACE_TENANT_ID,peerSecret:env.CORE_PEER_SECRET,cookieKey:env.PEE_COOKIE_KEY,workspaceName:'Expert Energy',activityEnabled:env.PEE_ACTIVITY_ENABLED==='true'};
 if(!identifier(config.organization)||!identifier(config.tenant)||!token(config.peerSecret)||!token(config.cookieKey)||config.peerSecret===config.cookieKey||config.publicOrigin===config.coreOrigin)throw Error('Dedicated Core access configuration required');
 return config;
}

export function createAccessServer({config,transport,now=Date.now,application}={}){
 if(!config||!identifier(config.organization)||!identifier(config.tenant)||!token(config.peerSecret)||!token(config.cookieKey)||config.peerSecret===config.cookieKey)throw Error('Invalid access configuration');
 config={...config,publicOrigin:httpsOrigin(config.publicOrigin),coreOrigin:httpsOrigin(config.coreOrigin)};
 const core=transport??createCoreTransport({organization:config.organization,tenant:config.tenant,now});const sealer=createSealer(config.cookieKey,{now});const usedStates=new Map();
 const app=application??(process.env.PEE_PROJECTS_ENABLED==='true'?createApplication({publicOrigin:config.publicOrigin,coreOrigin:config.coreOrigin,workspace:config.workspaceName,coreCall:core.call,activityEnabled:config.activityEnabled===true}):null);
 function origin(req){if(req.headers.origin!==config.publicOrigin)deny(403,'Origem não autorizada');}
 function machine(req){if(!equalSecret(req.headers.authorization,'Bearer '+config.peerSecret))deny(401,'Serviço não autorizado');}
 function session(req){const s=sealer.open('session',cookies(req)[SESSION]);if(!exact(s,['organization','tenant','subject','coreToken','csrf'])||s.organization!==config.organization||s.tenant!==config.tenant||!identifier(s.subject)||!token(s.coreToken)||!token(s.csrf))deny(401,'Sessão inválida');return s;}
 async function authorized(req){const s=session(req),result=await core.call('introspect',{organization_id:s.organization,audience:'energyos-pee',token:s.coreToken});if(result.sub!==s.subject||result.tenant_id!==s.tenant||result.organization_id!==s.organization)deny(403,'O contexto de acesso foi alterado. Entre novamente.');return {session:s,grant:result};}
 function json(res,status,value){res.statusCode=status;res.setHeader('Content-Type','application/json; charset=utf-8');res.end(JSON.stringify(value));}
 function page(res,title,body,script=''){
  const nonce=randomBytes(16).toString('base64');res.setHeader('Content-Type','text/html; charset=utf-8');res.setHeader('Content-Security-Policy',`default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; img-src data:; font-src data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'`);
  res.end(`<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(title)} · EnergyOS – PEE</title><style nonce="${nonce}">${embeddedFonts}${brandCss}*{box-sizing:border-box}body{margin:0;background:#080c11;color:#eef2f4;font:16px/1.6 system-ui,sans-serif}main{max-width:1050px;margin:0 auto;padding:52px 28px}a{color:#b7e987}h1{font-size:clamp(2rem,5vw,3.6rem);line-height:1.15;letter-spacing:-.045em;margin:38px 0 22px}h2{font-size:1.2rem}.brand{font-size:32px;letter-spacing:-.05em}.brand b{background:linear-gradient(105deg,#b7e987,#a5d995,#70b9a3);color:transparent;background-clip:text}.tag{font-size:10px;letter-spacing:.24em;color:#b7e987}.muted{color:#a9b9bc}section{padding:28px;border:1px solid #294246;border-radius:16px;margin:22px 0;background:#111920}button,.action{display:inline-block;background:#b7e987;color:#0b1915;padding:13px 22px;border:0;border-radius:8px;font:inherit;font-weight:650;text-decoration:none;cursor:pointer}.status{font-size:13px;display:inline-block;color:#b7e987;border:1px solid #294b36;border-radius:30px;padding:6px 12px}footer{margin-top:45px;color:#a9b9bc;font-size:13px}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:18px}ul{padding-left:22px}button:disabled{opacity:.5;cursor:default}[role=alert]{color:#f3bc9f}</style></head><body><main>${brandMarkup()}${body}<footer>${app?'EnergyOS – PEE. Recursos e projetos dependem das regras do edital e de validação técnica.':'Ambiente de homologação do acesso.'}</footer></main>${script?`<script nonce="${nonce}">${script}</script>`:''}</body></html>`);
 }
 const callbackScript=`(async()=>{const p=new URLSearchParams(location.hash.slice(1));history.replaceState(null,'','/sso/core');const label=document.getElementById('status');try{const r=await fetch('/auth/core/exchange',{method:'POST',headers:{'Content-Type':'application/json'},credentials:'same-origin',redirect:'error',body:JSON.stringify({code:p.get('code'),organization_id:p.get('organization_id'),state:p.get('state')})});if(!r.ok)throw Error();location.replace('/app');}catch{label.textContent='Não foi possível confirmar o acesso. Volte ao Core e tente novamente.';label.setAttribute('role','alert');}})();`;
 const server=http.createServer(async(req,res)=>{
  res.setHeader('Cache-Control','no-store');res.setHeader('Pragma','no-cache');res.setHeader('Referrer-Policy','no-referrer');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Content-Security-Policy',"default-src 'none'; frame-ancestors 'none'");
  try{
   if((req.url??'').length>2048)deny(414,'Endereço inválido');const path=new URL(req.url,'http://local.invalid').pathname;
   if(req.method==='GET'&&path==='/health')return json(res,200,{service:'energyos-pee-core-api',enabled:!!app,ready:!!app&&core.ready(),access_enabled:true,activity_renewal_enabled:config.activityEnabled===true,idle_timeout_seconds:config.activityEnabled?900:null,core_connected:core.ready(),project_storage_configured:!!app,licensing_enabled:false,eva_enabled:false,mail_enabled:false,status:app?'project-platform':core.ready()?'access-homologation':'awaiting-core'});
   if(req.method==='POST'&&path==='/internal/core/poll'){
    machine(req);const body=await jsonBody(req);if(!exact(body,['organization_id'])||body.organization_id!==config.organization)deny(403,'Organização não autorizada');const abort=new AbortController();res.once('close',()=>abort.abort());const task=await core.poll(abort.signal);if(!res.destroyed)return json(res,200,{task});return;
   }
   if(req.method==='POST'&&path==='/internal/core/reply'){machine(req);core.reply(await jsonBody(req));return json(res,200,{ok:true});}
   if(req.method==='GET'&&path==='/auth/core/start'){
    const state=opaque(),verifier=opaque();res.setHeader('Set-Cookie',cookie(STATE,sealer.seal('state',{state,verifier},180),180));const target=new URL('/pee/authorize',config.coreOrigin);target.search=new URLSearchParams({state,code_challenge:digest(verifier)}).toString();res.writeHead(302,{Location:target.href});return res.end();
   }
   if(req.method==='GET'&&path==='/sso/core')return page(res,'Confirmando acesso','<h1>Confirmando seu acesso.</h1><p id="status" role="status">Aguarde a confirmação do Energy Core.</p><p><a href="/auth/core/start">Iniciar novamente</a></p>',callbackScript);
   if(req.method==='POST'&&path==='/auth/core/exchange'){
    origin(req);const body=await jsonBody(req,4096);if(!exact(body,['code','organization_id','state'])||!token(body.code)||!token(body.state)||body.organization_id!==config.organization)deny(400,'Solicitação inválida');
    const transient=sealer.open('state',cookies(req)[STATE]);if(!exact(transient,['state','verifier'])||!token(transient.state)||!token(transient.verifier)||!equalSecret(body.state,transient.state))deny(403,'A confirmação de acesso não pertence a este navegador');
    for(const [id,until] of usedStates)if(until<=now())usedStates.delete(id);if(usedStates.has(transient.state))deny(409,'Solicitação já utilizada');if(usedStates.size>=2048)deny(503,'Aguarde antes de tentar novamente');usedStates.set(transient.state,now()+180000);
    const result=await core.call('exchange',{organization_id:config.organization,audience:'energyos-pee',code:body.code,code_verifier:transient.verifier});
    if(result.tenant_id!==config.tenant)deny(403,'Workspace não autorizado');
    const context={organization:config.organization,tenant:result.tenant_id,subject:result.sub,coreToken:result.token,csrf:opaque()};
    res.setHeader('Set-Cookie',[cookie(STATE,'',0),cookie(SESSION,sealer.seal('session',context,result.expires_in),result.expires_in)]);return json(res,200,{ok:true});
   }
   if(req.method==='GET'&&path==='/api/session'){
    const {session:s,grant:g}=await authorized(req);return json(res,200,{workspace:config.workspaceName??'Expert Energy',role:g.role,scopes:g.scopes,monthly_project_limit:g.monthly_project_limit,csrf:s.csrf,expires_at:g.expires_at});
   }
   if(req.method==='POST'&&path==='/api/app/activity'){
    if(!config.activityEnabled)deny(503,'Renovação por atividade ainda em atualização.');
    origin(req);const body=await jsonBody(req,2048);if(!exact(body,['csrf','activity_age_ms'])||!Number.isInteger(body.activity_age_ms)||body.activity_age_ms<0||body.activity_age_ms>60000)deny(400,'Solicitação inválida');const s=session(req);if(!equalSecret(body.csrf,s.csrf))deny(403,'Confirmação de sessão inválida');
    const g=await core.call('activity',{organization_id:s.organization,audience:'energyos-pee',token:s.coreToken,activity_age_ms:body.activity_age_ms});
    if(g.sub!==s.subject||g.tenant_id!==s.tenant||g.organization_id!==s.organization)deny(403,'Contexto alterado. Entre novamente.');
    const remaining=Math.max(1,Math.min(900,Math.floor((Date.parse(g.expires_at)-now())/1000)));
    res.setHeader('Set-Cookie',cookie(SESSION,sealer.seal('session',s,remaining),remaining));return json(res,200,{expires_at:g.expires_at,idle_seconds:900});
   }
   if(req.method==='POST'&&path==='/auth/logout'){
    origin(req);const body=await jsonBody(req,2048);if(!exact(body,['csrf']))deny(400,'Solicitação inválida');let s;try{s=session(req);}catch{res.setHeader('Set-Cookie',cookie(SESSION,'',0));return json(res,200,{ok:true});}if(!equalSecret(body.csrf,s.csrf))deny(403,'Confirmação de sessão inválida');res.setHeader('Set-Cookie',cookie(SESSION,'',0));return json(res,200,{ok:true});
   }
   if(app&&await app.handle(req,res,path,authorized))return;
   if(req.method==='GET'&&path==='/app'){
    const {session:s,grant:g}=await authorized(req);const role={viewer:'Consulta',editor:'Elaboração',reviewer:'Revisão técnica'}[g.role];
    return page(res,'Workspace',`<p class="status">Acesso confirmado pelo Core</p><h1>${escape(config.workspaceName??'Expert Energy')}</h1><p class="muted">Seu ambiente de projetos PEE.</p><div class="grid"><section><h2>Seu perfil</h2><p>${escape(role)}</p></section><section><h2>Limite configurado</h2><p>${g.monthly_project_limit} projetos por mês</p></section></div><section><h2>Elaboração de projetos</h2><p>A liberação deste módulo aguarda a homologação do cadastro de projetos, documentos e consumo das cotas.</p><button disabled>Novos projetos em homologação</button></section><p><a href="${escape(config.coreOrigin)}/pee">Voltar ao Energy Core</a></p><button id="logout" type="button">Sair deste ambiente</button><p id="notice" role="status"></p>`,`document.getElementById('logout').addEventListener('click',async()=>{try{const r=await fetch('/auth/logout',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({csrf:${JSON.stringify(s.csrf)}})});if(!r.ok)throw Error();location.replace('/');}catch{document.getElementById('notice').textContent='Não foi possível confirmar a saída. Tente novamente.';}});`);
   }
   if(req.method==='GET'&&path==='/'&&app){res.writeHead(302,{Location:'/commercial'});res.end();return;}
   if(req.method==='GET'&&path==='/')return page(res,'Acesso','<p class="status">Homologação do acesso</p><h1>Do potencial energético<br>ao projeto PEE.</h1><p class="muted">Engenharia, documentação e inteligência para preparar projetos de eficiência energética.</p><section><h2>Usuários do Energy Core</h2><p>Entre com seu acesso do Core. A plataforma confirma a permissão individual e a organização autorizada.</p><a class="action" href="/auth/core/start">Entrar pelo Energy Core</a></section><section><h2>Organizações licenciadas</h2><p>A contratação e o acesso por licença serão liberados após a homologação do contrato, assinatura e aprovação pelo Core.</p></section>');
   if(path.startsWith('/v1/'))return json(res,503,{error:'PEE_CORE_DISABLED',message:'A operação solicitada não está disponível nesta configuração.'});
   return json(res,404,{message:'Página não encontrada'});
  }catch(e){const known=e instanceof AccessFailure||e instanceof ProjectError||e instanceof StoreError,status=known?e.status:503;
   if(req.method==='GET'&&new URL(req.url,'http://local.invalid').pathname==='/app'){
    res.statusCode=status;return page(res,'Renovar acesso','<h1>Entre novamente pelo Core.</h1><p>Esta sessão expirou, teve a permissão alterada ou não pôde ser confirmada. Seus dados salvos permanecem no workspace.</p><p><a class="action" href="/auth/core/start">Entrar pelo Energy Core</a></p><p><a href="'+escape(config.coreOrigin)+'/pee">Consultar sua permissão no Core</a></p>');
   }
   return json(res,status,{message:known?e.message:'Não foi possível confirmar a operação. Atualize os dados antes de repetir.'});}
 });
 server.requestTimeout=35000;server.headersTimeout=10000;server.on('close',()=>core.close());return {server,transport:core};
}

export function startAccessServer(){const config=accessConfiguration();if(!config)throw Error('Access mode is disabled');const {server}=createAccessServer({config});server.listen(Number(process.env.PORT||3001),'0.0.0.0',()=>process.stdout.write(process.env.PEE_PROJECTS_ENABLED==='true'?'EnergyOS PEE project service started.\n':'EnergyOS PEE access homologation started.\n'));return server;}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)startAccessServer();
