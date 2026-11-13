import {scheduledWorkEnabled} from './process-role';
// Process-local admission, in addition to the existing durable database leases.
let running=0;
const pollers=new Set<EvaPoller>();
/** Conservative default for shared database pressure; scaling remains explicitly bounded. */
export function evaConcurrencyLimit(){return process.env.EVA_WORKER_MAX_CONCURRENCY==='2'?2:1;}
/** Local scheduler pressure, not the number of documents in the durable queue. */
export function evaPollingMetrics(){
 let backingOff=0;
 for(const poller of pollers)if(poller.isBackingOff())backingOff++;
 return {registered:pollers.size,activeTasks:running,backingOff,concurrencyLimit:evaConcurrencyLimit()};
}
export function wakeEvaWorkers(){for(const poller of pollers)poller.wake();}
export class EvaPoller{
 private timer?:ReturnType<typeof setTimeout>;private stopped=true;private busy=false;
 private idle=0;private failures=0;private active=false;
 private task?:()=>Promise<unknown>;private onError?:()=>void;private base=5000;
 activity(){this.active=true;}
 isBackingOff(){return this.failures>0;}
 start(task:()=>Promise<unknown>,base:number,onError:()=>void){
  if(!this.stopped||!scheduledWorkEnabled('EVA'))return;
  this.stopped=false;this.task=task;this.base=base;this.onError=onError;pollers.add(this);this.schedule(base);
 }
 stop(){this.stopped=true;clearTimeout(this.timer);pollers.delete(this);}
 wake(){if(this.stopped||this.busy||this.failures)return;this.idle=0;clearTimeout(this.timer);this.schedule(1000);}
 private schedule(delay:number){if(this.stopped)return;this.timer=setTimeout(()=>void this.tick(),delay);this.timer.unref?.();}
 private async tick(){
  if(this.stopped)return;
  if(running>=evaConcurrencyLimit()){this.schedule(this.base);return;}
  running++;this.busy=true;this.active=false;
  try{await this.task!();this.failures=0;this.idle=this.active?0:Math.min(6,this.idle+1);}
  catch{this.failures=Math.min(5,this.failures+1);this.onError?.();}
  finally{
   running--;this.busy=false;
   // An uncertain write is never replayed here: the next iteration claims a durable job.
   const delay=this.failures?Math.min(300000,30000*2**(this.failures-1)):Math.min(30000,this.base*2**this.idle);
   this.schedule(Math.min(300000,Math.round(delay*(1+Math.random()*.1))));
  }
 }
}
