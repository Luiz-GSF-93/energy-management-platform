import{randomBytes}from'node:crypto';
import{AccessFailure,identifier}from'./core-transport.mjs';
import{supabaseServerHeaders}from'./supabase-auth.mjs';
const deny=()=>{throw new AccessFailure(401,'Não foi possível confirmar o acesso. Confira seu cadastro, sua licença e suas credenciais.');};
export function createLicensedIdentity(env=process.env,{fetcher=fetch}={}){
 if(env.PEE_LICENSING_ENABLED!=='true')return null;
 const base=new URL(env.SUPABASE_URL??'');if(base.origin!=='https://xogqasqiqktjsjunmcet.supabase.co')throw Error('Dedicated PEE identity required');
 const server=supabaseServerHeaders(env);
 async function request(path,body,accessToken,method=body?'POST':'GET'){
  if(!['/auth/v1/admin/generate_link','/auth/v1/token?grant_type=password','/auth/v1/token?grant_type=refresh_token','/auth/v1/user','/auth/v1/verify','/auth/v1/logout?scope=local'].includes(path))deny();
  let r;try{r=await fetcher(new URL(path,base),{method,headers:{apikey:server.apikey,'Content-Type':'application/json',...(accessToken?{Authorization:'Bearer '+accessToken}:{})},...(body?{body:JSON.stringify(body)}:{}),redirect:'error',signal:AbortSignal.timeout(15000)});}catch{deny();}
  if(!r.ok){await r.body?.cancel();deny();}const raw=await r.text();if(raw.length>24000)deny();try{return raw?JSON.parse(raw):{};}catch{deny();}
 }
 const password=v=>{if(typeof v!=='string'||v.length<12||v.length>128||!/[a-z]/.test(v)||!/[A-Z]/.test(v)||!/[0-9]/.test(v)||!/[\W_]/.test(v))throw new AccessFailure(422,'Use senha entre 12 e 128 caracteres, com maiúscula, minúscula, número e símbolo.');return v;};
 const session=v=>{if(typeof v.access_token!=='string'||v.access_token.length>1800||typeof v.refresh_token!=='string'||v.refresh_token.length>300)deny();return{access_token:v.access_token,refresh_token:v.refresh_token};};
 async function user(access){const u=await request('/auth/v1/user',undefined,access);if(!identifier(u.id)||typeof u.email!=='string'||!u.email_confirmed_at)deny();return{id:u.id,email:u.email.toLowerCase()};}
 return{user,async login(email,pass){if(typeof pass!=='string'||pass.length>128)deny();const s=session(await request('/auth/v1/token?grant_type=password',{email,password:pass}));return{...s,user:await user(s.access_token)};},
 async refresh(refresh_token){return session(await request('/auth/v1/token?grant_type=refresh_token',{refresh_token}));},
 async link(email,kind,pass){if(!['signup','recovery'].includes(kind))deny();const r=await request('/auth/v1/admin/generate_link',{type:kind,email,...(kind==='signup'?{password:randomBytes(32).toString('base64url')+'!Aa1'}:{})});const h=r.hashed_token??r.properties?.hashed_token;if(typeof h!=='string'||!/^[a-f0-9]{40,128}$/i.test(h))deny();return h;},
 async confirm(token_hash,type,pass){if(typeof token_hash!=='string'||!/^[a-f0-9]{40,128}$/i.test(token_hash)||!['signup','recovery'].includes(type))deny();password(pass);const s=session(await request('/auth/v1/verify',{token_hash,type}));await request('/auth/v1/user',{password:pass},s.access_token,'PUT');await request('/auth/v1/logout?scope=local',{},s.access_token).catch(()=>{});return{confirmed:true};},
 async logout(access){await request('/auth/v1/logout?scope=local',{},access);}
 };
}
