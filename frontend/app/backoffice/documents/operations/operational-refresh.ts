export type RefreshState={mode:'updating'|'scheduled'|'paused';delayMs:number};
type Options<T>={read:(signal:AbortSignal)=>Promise<T>;canRead:()=>boolean;result:(value:T)=>void;error:(error:unknown)=>void;state:(state:RefreshState)=>void};

/** Only query results are refreshed. This scheduler never submits or repeats a mutation. */
export function createOperationalRefresh<T>(options:Options<T>){
 let stopped=false,busy=false,failures=0;
 let timer:ReturnType<typeof setTimeout>|undefined,deadline:ReturnType<typeof setTimeout>|undefined,controller:AbortController|undefined;
 async function poll(){
  if(stopped||busy)return;
  if(!options.canRead()){options.state({mode:'paused',delayMs:0});return;}
  busy=true;options.state({mode:'updating',delayMs:0});
  const request=new AbortController();controller=request;
  let cancelled:()=>void;
  const cancellation=new Promise<never>((_,reject)=>{
   cancelled=()=>reject(Object.assign(Error('OPERATIONAL_QUERY_ABORTED'),{name:'AbortError'}));
   request.signal.addEventListener('abort',cancelled,{once:true});
   deadline=setTimeout(()=>request.abort(),15000);
  });
  try{
   const result=await Promise.race([Promise.resolve().then(()=>options.read(request.signal)),cancellation]);
   if(!stopped&&!request.signal.aborted){failures=0;options.result(result);}
  }catch(error){if(!stopped){failures=Math.min(2,failures+1);options.error(error);}}
  finally{
   clearTimeout(deadline);request.signal.removeEventListener('abort',cancelled!);busy=false;controller=undefined;
   if(!stopped){
    if(options.canRead()){
     const delayMs=30000*2**failures;
     timer=setTimeout(()=>void poll(),delayMs);options.state({mode:'scheduled',delayMs});
    }else options.state({mode:'paused',delayMs:0});
   }
  }
 }
 const refresh=()=>{if(stopped||busy)return;clearTimeout(timer);void poll();};
 const stop=()=>{stopped=true;clearTimeout(timer);clearTimeout(deadline);controller?.abort();};
 refresh();return {refresh,stop};
}
