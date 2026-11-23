import{createHash}from'node:crypto';
import{AccessFailure,identifier}from'./core-transport.mjs';
const deny=()=>{throw new AccessFailure(401,'A senha provisória já foi utilizada, expirou ou não pertence a esta sessão. Use a recuperação de senha para obter um novo acesso.');};
const digest=v=>createHash('sha256').update(v).digest('hex');
// The caller must first validate this access token with Supabase /auth/v1/user.
// Session identifiers are stable across refreshes, unlike access-token strings.
export function temporaryPasswordContext(verifiedUser,verifiedAccess,now=Date.now()){
 const m=verifiedUser.app_metadata??{};if(m.pee_temporary_password!==true)return null;
 const expires=Date.parse(m.pee_password_expires_at);if(!Number.isFinite(expires)||expires<=now)return{required:true,expired:true};
 let session;try{session=JSON.parse(Buffer.from(verifiedAccess.split('.')[1],'base64url')).session_id;}catch{}
 if(!identifier(verifiedUser.id)||!identifier(session))deny();
 return{required:true,expired:false,user_id:verifiedUser.id,generation:digest(verifiedUser.id+'\n'+String(m.pee_temporary_generation??m.pee_password_expires_at)),session_hash:digest(session),expires_at:new Date(expires).toISOString()};
}
export function createTemporaryPasswordControl({rpc,now=Date.now}){
 async function check(user,access,action,tenant=null){const context=temporaryPasswordContext(user,access,now());if(!context)return{required:false,expired:false};if(context.expired){if(action==='claim')deny();return{required:true,expired:true};}const r=await rpc({p_user_id:context.user_id,p_tenant_id:tenant,p_generation:context.generation,p_session_hash:context.session_hash,p_expires_at:context.expires_at,p_action:action});if(r?.allowed!==true)deny();return{required:true,expired:false};}
 return{claim:(u,a,t)=>check(u,a,'claim',t),status:(u,a)=>check(u,a,'status')};
}
