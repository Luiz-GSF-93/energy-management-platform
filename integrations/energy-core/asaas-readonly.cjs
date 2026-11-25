'use strict';
// Install in Energy Core's backend only. Never import into EnergyOS frontend.
// No create, charge, subscription, refund, license or mutation methods.
const {timingSafeEqual}=require('node:crypto');
function configuration(env){
 if(env.CORE_ASAAS_ENABLED!=='true')throw Error('Asaas no Energy Core ainda não habilitado.');
 const mode=env.CORE_ASAAS_ENVIRONMENT;
 if(!['sandbox','production'].includes(mode)||mode==='production'&&env.CORE_ASAAS_PRODUCTION_READ_ENABLED!=='true')throw Error('Ambiente Asaas não autorizado.');
 const key=mode==='sandbox'?env.CORE_ASAAS_SANDBOX_API_KEY:env.CORE_ASAAS_PRODUCTION_API_KEY;
 if(typeof key!=='string'||!key.startsWith(mode==='sandbox'?'$aact_hmlg_':'$aact_prod_')||/\s/.test(key)||key.length>4096)throw Error('Credencial incompatível com o ambiente Asaas.');
 return {url:mode==='sandbox'?'https://api-sandbox.asaas.com/v3':'https://api.asaas.com/v3',key};
}
async function payment(env,id,transport=fetch){
 const {url,key}=configuration(env);
 if(typeof id!=='string'||!/^pay_[a-zA-Z0-9_]{1,100}$/.test(id))throw Error('Identificador de cobrança inválido.');
 let reader;
 try{
  const r=await transport(url+'/payments/'+id,{method:'GET',redirect:'error',signal:AbortSignal.timeout(10000),headers:{access_token:key,Accept:'application/json','User-Agent':'EnergyCore-LicenseSales/1.0'}});
  if(r.status!==200||!r.headers.get('content-type')?.includes('application/json')){await r.body?.cancel();throw Error();}
  if(Number(r.headers.get('content-length')||0)>65536){await r.body?.cancel();throw Error();}
  reader=r.body?.getReader();if(!reader)throw Error();let size=0;const chunks=[];
  while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>65536)throw Error();chunks.push(value);}
  const b=JSON.parse(Buffer.concat(chunks).toString('utf8'));
  const amount=b.value;
  if(b.id!==id||typeof b.customer!=='string'||!/^cus_[a-zA-Z0-9]{1,100}$/.test(b.customer)||typeof b.status!=='string'||!/^[A-Z_]{1,60}$/.test(b.status)||typeof amount!=='number'||!Number.isFinite(amount)||amount<0||!Number.isSafeInteger(Math.round(amount*100))||Math.abs(amount*100-Math.round(amount*100))>0.000001)throw Error();
  return {id:b.id,customer:b.customer,status:b.status,grossCents:Math.round(amount*100),externalReference:typeof b.externalReference==='string'&&b.externalReference.length<=150?b.externalReference:null};
 }catch{throw Error('Consulta Asaas não confirmada; nenhum pagamento ou licença foi alterado.');}
 finally{try{await reader?.cancel();}catch{}}
}
function webhookAuthorized(env,token){
 const key=env.CORE_ASAAS_WEBHOOK_TOKEN;
 if(typeof key!=='string'||!/^\S{43,255}$/.test(key)||[env.CORE_ASAAS_SANDBOX_API_KEY,env.CORE_ASAAS_PRODUCTION_API_KEY,env.SALES_CORE_BRIDGE_TOKEN].includes(key)||typeof token!=='string'||token.length>255)return false;
 const a=Buffer.from(key),b=Buffer.from(token);return a.length===b.length&&timingSafeEqual(a,b);
}
module.exports={configuration,payment,webhookAuthorized};
