import {ServiceUnavailableException} from '@nestjs/common';

/** Only an explicitly read-only operation may use this recoverable error. */
export class EvaReadUnavailable extends ServiceUnavailableException{
 constructor(read:string){super({code:'EVA_READ_UNAVAILABLE',read,message:'A consulta temporária não foi concluída. Suas confirmações anteriores foram preservadas; a consulta pode ser retomada sem reenviar o documento.'});}
}
export async function readDeadline<T>(read:string,run:(signal:AbortSignal)=>PromiseLike<T>,milliseconds=25000):Promise<T>{
 const controller=new AbortController();let timer:ReturnType<typeof setTimeout>;
 const deadline=new Promise<never>((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(new EvaReadUnavailable(read));},milliseconds);});
 try{return await Promise.race([Promise.resolve().then(()=>run(controller.signal)),deadline]);}
 catch(e){if(e instanceof EvaReadUnavailable)throw e;if((e as any)?.getStatus?.()===503||['AbortError','TimeoutError'].includes((e as any)?.name))throw new EvaReadUnavailable(read);throw e;}
 finally{clearTimeout(timer!);}
}
const reads:Record<string,string[]|null>={eva_intake_action:['list'],eva_intake_administration:['list'],eva_intake_identity_action:['list','justifications'],eva_intake_published_completions:null,eva_intake_prepared_checkpoint:null,eva_intake_source_state:null,eva_scoped_closing_action:['history','capture']};
export async function readRpc(db:any,name:string,args:any,milliseconds=25000){
 if(!(name in reads)||reads[name]&&!reads[name]!.includes(args.p_action))throw Error('READ_RPC_NOT_ALLOWLISTED');
 const read=name+':'+(args.p_action??'lookup');
 const result:any=await readDeadline(read,signal=>{const request=db.rpc(name,args);return typeof request.abortSignal==='function'?request.abortSignal(signal):request;},milliseconds);
 if(name!=='eva_intake_published_completions'&&result?.error&&(result.error.code==='57014'||/^PGRST00[0-3]$/.test(result.error.code??'')||(!result.error.code&&(!result.status||result.status>=500))))throw new EvaReadUnavailable(read);
 return result;
}

/** A REST SELECT has no financial effect. Abort a hung transport, never replay
 * POST/PATCH/DELETE, uploads, authentication or an unknown RPC here. */
export function boundedRestReads(transport:typeof fetch=fetch,milliseconds=25000):typeof fetch{
 return (async(input:any,init?:RequestInit)=>{
  const url=new URL(typeof input==='string'?input:input instanceof URL?input.href:input.url);
  const method=(init?.method??(typeof Request!=='undefined'&&input instanceof Request?input.method:'GET')).toUpperCase();
  if(method!=='GET'||!url.pathname.startsWith('/rest/v1/'))return transport(input,init);
  const parent=init?.signal??(typeof Request!=='undefined'&&input instanceof Request?input.signal:null),controller=new AbortController();
  const abort=()=>controller.abort();if(parent?.aborted)abort();else parent?.addEventListener('abort',abort,{once:true});
  const timer=setTimeout(abort,milliseconds);timer.unref?.();
  const cleanup=()=>{clearTimeout(timer);parent?.removeEventListener('abort',abort);};
  try{
   const response=await transport(input,{...init,signal:controller.signal});
   if(!response.body){cleanup();return response;}
   const reader=response.body.getReader();
   const body=new ReadableStream<Uint8Array>({
    async pull(target){try{const next=await reader.read();if(next.done){cleanup();target.close();}else target.enqueue(next.value);}catch(e){cleanup();target.error(e);}},
    async cancel(reason){cleanup();await reader.cancel(reason);},
   });
   return new Response(body,{status:response.status,statusText:response.statusText,headers:response.headers});
  }catch(e){cleanup();throw e;}
 }) as typeof fetch;
}
