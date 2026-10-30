import {apiRequest} from '@/app/lib/api/client';
/** Bound the entire read, including session renewal; never repeat a mutation. */
export async function supplierSourceRequest<T>(path:string,signal?:AbortSignal):Promise<T>{
 if(signal?.aborted)throw new Error('Consulta cancelada.');
 const controller=new AbortController();let timer:ReturnType<typeof setTimeout>|undefined;
 let cancel=()=>{};
 const stopped=new Promise<never>((_,reject)=>{
  cancel=()=>{reject(new Error('Consulta cancelada.'));controller.abort();};
  if(signal?.aborted){cancel();return;}
  signal?.addEventListener('abort',cancel,{once:true});
  timer=setTimeout(()=>{reject(new Error('A consulta das fontes demorou além do esperado. Os dados salvos foram preservados. Clique em Atualizar fontes da NF para consultar novamente.'));controller.abort();},45000);
 });
 try{return await Promise.race([stopped,apiRequest<T>(path,{signal:controller.signal})]);}
 finally{if(timer!==undefined)clearTimeout(timer);signal?.removeEventListener('abort',cancel);}
}
