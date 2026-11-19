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
  async rpc(context,action,data={}){return(await request('/rest/v1/rpc/pee_store',{method:'POST',body:JSON.stringify({p_actor:context.subject,p_tenant:context.tenant,p_role:context.role,p_core:context.source==='core',p_action:action,p_data:data})})).json();},
  async upload(key,bytes,mime){if(!/^[a-f0-9-]{36}\/[a-f0-9-]{36}\/[a-f0-9]{64}$/.test(key))throw Error('Invalid private object key');await request('/storage/v1/object/pee-private/'+key,{method:'POST',headers:{'Content-Type':mime,'x-upsert':'false'},body:bytes});},
  async download(key){if(!/^[a-f0-9-]{36}\/[a-f0-9-]{36}\/[a-f0-9]{64}$/.test(key))throw Error('Invalid private object key');return request('/storage/v1/object/authenticated/pee-private/'+key,{method:'GET'});},
 };
}
