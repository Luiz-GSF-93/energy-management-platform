// No timer-only keepalive: renewal always requires newer trusted user input.
export function createActivityTracker({now=Date.now,renew,onLock,hidden=()=>false,idleMs=900000,throttleMs=45000}){
 let lastActivity=now(),lastSent=null,dirty=false,pending=false,locked=false;
 function lock(reason){if(!locked){locked=true;onLock(reason);}}
 async function tick(){
  if(locked)return;if(now()-lastActivity>=idleMs){lock('idle');return;}
  if(!dirty||pending||hidden()||lastSent!==null&&now()-lastSent<throttleMs)return;
  const activity=lastActivity,age=Math.max(0,Math.floor(now()-activity));if(age>60000)return;
  pending=true;lastSent=now();
  try{await renew(age);dirty=lastActivity>activity;}catch(e){if(e?.status===401||e?.status===403)lock('access');}finally{pending=false;}
 }
 function activity(event){if(event?.isTrusted!==true||hidden()||locked)return;lastActivity=now();dirty=true;void tick();}
 return {activity,tick,stop:()=>{locked=true;},state:()=>({lastActivity,lastSent,dirty,pending,locked})};
}
