import {Injectable,Logger,OnModuleInit,OnModuleDestroy} from '@nestjs/common';
import {SupabaseService} from '../../services/supabase.service';

/** DB serializes replicas and persists monthly cursor. Never moves or purges records. */
@Injectable()
export class AuditRetentionWorker implements OnModuleInit,OnModuleDestroy {
 private timer?:ReturnType<typeof setTimeout>;private stopped=false;
 private readonly logger=new Logger(AuditRetentionWorker.name);private readonly client:any;
 constructor(db:SupabaseService){this.client=db.createAuthClient();}
 onModuleInit(){this.schedule();}
 onModuleDestroy(){this.stopped=true;if(this.timer)clearTimeout(this.timer);}
 private schedule(){if(this.stopped)return;this.timer=setTimeout(async()=>{try{await this.tick();}catch{this.logger.warn('AUDIT_RETENTION_SIMULATION_PENDING');}finally{this.schedule();}},60000);this.timer.unref();}
 async tick(){const {data,error}=await this.client.rpc('energy_audit_retention_tick',{p_limit:100});if(error)throw Error('AUDIT_RETENTION_INVENTORY_UNAVAILABLE');return data;}
}
