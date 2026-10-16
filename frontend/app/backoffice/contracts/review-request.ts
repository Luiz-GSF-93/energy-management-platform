import {apiRequest} from '@/app/lib/api/client';
/** A timed-out mutation is reconciled through history, never submitted automatically again. */
export async function reviewRequest<T>(path:string,options:Parameters<typeof apiRequest>[1]={}):Promise<T>{
 const controller=new AbortController();let expired=false;
 const cancel=()=>controller.abort();if(options.signal?.aborted)cancel();else options.signal?.addEventListener('abort',cancel,{once:true});
 const timer=setTimeout(()=>{expired=true;controller.abort()},90000);
 try{return await apiRequest<T>(path,{...options,signal:controller.signal})}
 catch(e){if(expired)throw new Error('O tempo de espera terminou. Confira o histórico antes de repetir.');throw e}
 finally{clearTimeout(timer);options.signal?.removeEventListener('abort',cancel)}
}
