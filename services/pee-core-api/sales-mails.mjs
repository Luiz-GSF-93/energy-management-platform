import{createHash}from'node:crypto';import{emailAddress,communicationHash}from'./communications-policy.mjs';import{AccessFailure,identifier}from'./core-transport.mjs';
const sha=x=>createHash('sha256').update(x).digest('hex');
export function createSalesMails({store,provider,identity,publicOrigin}){
 return async function send(kind,b){
  if(!['offer','welcome'].includes(kind)||!b||!identifier(b.id)||!identifier(b.license_id)||typeof b.name!=='string'||!b.name.trim()||b.name.length>200||typeof b.organization!=='string'||!b.organization.trim()||b.organization.length>300||Object.keys(b).some(k=>!['id','license_id','member_id','name','email','organization','url'].includes(k)))throw new AccessFailure(422,'Comunicação comercial inválida.');emailAddress(b.email);
  if(kind==='offer'){const u=new URL(b.url);if(u.origin!==publicOrigin||u.pathname!=='/offer'||u.search)throw new AccessFailure(422,'Oferta inválida.');}
  else if(!identifier(b.member_id))throw new AccessFailure(422,'Usuário não informado.');
  const hash=communicationHash(b);let row=await store.notice('prepare',{id:b.id,license_id:b.license_id,request_hash:hash,recipient_hash:sha(emailAddress(b.email))});if(row.provider_id)return{state:'accepted',provider_id:row.provider_id};
  row=await store.notice('start',{id:b.id,request_hash:hash});if(row.provider_id)return{state:'accepted',provider_id:row.provider_id};
  try{let result;if(kind==='offer')result=await provider.offer({...b,origin:publicOrigin});else{const account=await identity.provisionTemporaryPassword(b.email);result=await provider.welcome({...b,origin:publicOrigin,temporary_password:account.password??null,expires_hours:24});}
   if(!identifier(result?.id))throw Error('PROVIDER_ID');await store.notice('accepted',{id:b.id,provider_id:result.id});return{state:'accepted',provider_id:result.id};
  }catch{await store.notice('uncertain',{id:b.id});throw new AccessFailure(503,'Envio sem confirmação. Confira o registro antes de solicitar outro envio.');}
 };
}
