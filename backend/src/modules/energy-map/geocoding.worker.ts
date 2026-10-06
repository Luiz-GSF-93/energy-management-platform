import {Injectable,Logger,OnModuleDestroy,OnModuleInit} from '@nestjs/common';
import {ConfigService} from '@nestjs/config';
import {SupabaseService} from '../../services/supabase.service';
import {GeocodeFailure,MapboxGeocodingProvider,geocodeAddress} from './geocoding.provider';

@Injectable()
export class EnergyMapGeocodingWorker implements OnModuleInit,OnModuleDestroy {
 private readonly logger=new Logger(EnergyMapGeocodingWorker.name);
 private timer:ReturnType<typeof setTimeout>|undefined;
 private stopped=false;
 private busy=false;
 constructor(private db:SupabaseService,private config:ConfigService,private provider:MapboxGeocodingProvider){}
 private organizations(){
  const maps=(this.config.get<string>('ENERGY_MAP_ORGANIZATIONS')||'').split(',').map(v=>v.trim());
  return [...new Set((this.config.get<string>('ENERGY_MAP_GEOCODING_ORGANIZATIONS')||'').split(',').map(v=>v.trim()).filter(v=>v&&maps.includes(v)))].slice(0,100);
 }
 onModuleInit(){if(this.provider.configured()&&this.organizations().length)this.schedule();}
 onModuleDestroy(){this.stopped=true;if(this.timer)clearTimeout(this.timer);}
 private schedule(){if(this.stopped)return;this.timer=setTimeout(()=>{void this.runOnce().catch(()=>this.logger.warn('GEOCODING_WORKER_UNAVAILABLE')).finally(()=>this.schedule());},5000);this.timer.unref?.();}
 async runOnce(){
  const orgs=this.organizations();if(this.stopped||this.busy||!this.provider.configured()||!orgs.length)return;
  this.busy=true;
  try {
   const {data:job,error}=await this.db.getClient().rpc('dispatch_energy_map_geocoding',{p_orgs:orgs});
   if(error)throw new Error('DISPATCH_UNAVAILABLE');if(!job)return;
   // Reject a malformed/cross-scope response before any external disclosure.
   if(!orgs.includes(job.organizationId)||typeof job.actorId!=='string'||!job.actorId||
    ![job.jobId,job.leaseId].every(v=>typeof v==='string'&&/^[a-f0-9-]{36}$/i.test(v)))throw new Error('DISPATCH_INVALID');
   let candidates:unknown[]=[],failure:string|null=null;
   try {const address=geocodeAddress(job.address);candidates=await this.provider.locate(address);}
   catch(e){failure=e instanceof GeocodeFailure?e.code:'PROVIDER_UNAVAILABLE';}
   const finished=await this.db.getClient().rpc('finish_energy_map_geocoding',{p_org:job.organizationId,p_actor:job.actorId,
    p_job:job.jobId,p_lease:job.leaseId,p_candidates:candidates,p_error:failure});
   if(finished.error)throw new Error('FINISH_UNAVAILABLE');
  }finally{this.busy=false;}
 }
}
