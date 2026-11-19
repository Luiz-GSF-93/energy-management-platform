import {supabaseServerHeaders} from './supabase-auth.mjs';
export class StoreError extends Error{constructor(message,status=503){super(message);this.status=status;}}
export function createStore(env=process.env,{fetcher=fetch}={}){
 const base=new URL(env.SUPABASE_URL??'');if(base.protocol!=='https:'||base.username||base.password||base.pathname!=='/'||!base.hostname.endsWith('.supabase.co'))throw Error('Dedicated Supabase HTTPS URL required');
 if(base.hostname!=='xogqasqiqktjsjunmcet.supabase.co'&&env.NODE_ENV!=='test')throw Error('Use the dedicated PEE project');
 const headers=supabaseServerHeaders(env);
 async function request(path,options={}){
  let r;try{r=await fetcher(new URL(path,base),{...options,headers:{...headers,...options.headers},redirect:'error',signal:AbortSignal.timeout(20000)});}catch{throw new StoreError('Não foi possível confirmar a operação. Confira os dados antes de repetir.');}
  if(!r.ok){let code;try{code=(await r.json()).code;}catch{}
   if(code==='40001')throw new StoreError('Os dados foram alterados. Atualize antes de salvar.',409);
   if(code==='42501')throw new StoreError('Permissão ou licença indisponível.',403);
   if(code==='P0002')throw new StoreError('Registro não encontrado neste workspace.',404);
   if(code==='P0001')throw new StoreError('Limite mensal de emissão atingido.',409);
   throw new StoreError('O armazenamento não confirmou a operação.');
  }return r;
 }
 return {
  async verifyEmission(x){return(await request('/rest/v1/rpc/pee_verify_licensed_emission',{method:'POST',body:JSON.stringify({p_license:x.license_id,p_project:x.project_reference,p_emission:x.emission_reference})})).json();},
  async notice(action,data){return(await request('/rest/v1/rpc/pee_notice_system',{method:'POST',body:JSON.stringify({p_action:action,p_data:data})})).json();},
  async licensedStatus(c){return(await request('/rest/v1/rpc/pee_licensed_status',{method:'POST',body:JSON.stringify({p_actor:c.subject,p_tenant:c.tenant,p_role:c.role})})).json();},
  async royalty(c,action,data){return(await request('/rest/v1/rpc/pee_royalty_user',{method:'POST',body:JSON.stringify({p_actor:c.subject,p_tenant:c.tenant,p_role:c.role,p_action:action,p_data:data})})).json();},
  async syncLicense(grant){return(await request('/rest/v1/rpc/pee_sync_license',{method:'POST',body:JSON.stringify({p_grant:grant})})).json();},
  async rpc(context,action,data={}){return(await request('/rest/v1/rpc/pee_store',{method:'POST',body:JSON.stringify({p_actor:context.subject,p_tenant:context.tenant,p_role:context.role,p_core:context.source==='core',p_action:action,p_data:data})})).json();},
  async mail(context,action,data={}){return(await request('/rest/v1/rpc/pee_mail_user',{method:'POST',body:JSON.stringify({p_actor:context.subject,p_tenant:context.tenant,p_role:context.role,p_core:context.source==='core',p_action:action,p_data:data})})).json();},
  async mailSystem(action,data={}){return(await request('/rest/v1/rpc/pee_mail_system',{method:'POST',body:JSON.stringify({p_action:action,p_data:data})})).json();},
  async upload(key,bytes,mime){if(!/^[a-f0-9-]{36}\/[a-f0-9-]{36}\/[a-f0-9]{64}$/.test(key))throw Error('Invalid private object key');await request('/storage/v1/object/pee-private/'+key,{method:'POST',headers:{'Content-Type':mime,'x-upsert':'false'},body:bytes});},
  async download(key){if(!/^[a-f0-9-]{36}\/[a-f0-9-]{36}\/[a-f0-9]{64}$/.test(key))throw Error('Invalid private object key');return request('/storage/v1/object/authenticated/pee-private/'+key,{method:'GET'});},
 };
}
