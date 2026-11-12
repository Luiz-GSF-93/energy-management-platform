export type Availability={database:'up'|'down'|'unknown';auth:'up'|'down'|'unknown';checkedAt:string|null};
const unknown=():Availability=>({database:'unknown',auth:'unknown',checkedAt:null});

/** Reads the existing public, sanitized readiness only. Never attaches a session or tenant. */
export async function serviceAvailability(parent:AbortSignal):Promise<Availability>{
 const base=process.env.NEXT_PUBLIC_API_URL?.trim().replace(/\/+$/,'');
 if(!base||parent.aborted)return unknown();
 const controller=new AbortController(),abort=()=>controller.abort();
 parent.addEventListener('abort',abort,{once:true});
 const timer=setTimeout(abort,5000);
 try{
  const response=await fetch(base+'/api/v1/health/ready',{method:'GET',credentials:'omit',cache:'no-store',signal:controller.signal});
  if(!response.ok&&response.status!==503)return unknown();
  const data=await response.json();
  const valid=(v:unknown)=>v==='up'||v==='down';
  if(!valid(data?.dependencies?.database)||!valid(data?.dependencies?.auth)||typeof data.checkedAt!=='string'||!Number.isFinite(Date.parse(data.checkedAt)))return unknown();
  const up=data.dependencies.database==='up'&&data.dependencies.auth==='up';
  if(up?(response.status!==200||data.status!=='ready'):(response.status!==503||data.status!=='degraded'))return unknown();
  return {database:data.dependencies.database,auth:data.dependencies.auth,checkedAt:data.checkedAt};
 }catch{return unknown();}
 finally{clearTimeout(timer);parent.removeEventListener('abort',abort);}
}
