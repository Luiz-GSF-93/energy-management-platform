import {Body,Controller,ForbiddenException,Get,Header,Injectable,Logger,OnModuleDestroy,OnModuleInit,Param,Post} from '@nestjs/common';
import {Tenant} from '../../common/decorators/tenant.decorator';
import {TenantContext} from '../../common/interfaces/tenant-context.interface';
import {SupabaseService} from '../../services/supabase.service';
import {CceeDataService} from './ccee-data.service';
import {cceeObject,cceeUuid} from './ccee-data.model';
import {servicePolicyPlan} from './ccee-service-policy.model';
@Injectable()
export class CceeAutomaticService implements OnModuleInit,OnModuleDestroy{
 private timer?:ReturnType<typeof setTimeout>;private stopped=false;private busy=false;private log=new Logger(CceeAutomaticService.name);
 constructor(private db:SupabaseService,private data:CceeDataService){}
 private enabled(){return process.env.CCEE_AUTOMATIC_READ_ENABLED==='true'&&process.env.CCEE_DATA_WORKSPACE_ENABLED==='true'&&process.env.CCEE_SYNC_WORKER_ENABLED==='true';}
 async action(t:TenantContext,action:string,id:string|null,input:unknown={}){
  const workspace=await this.data.workspace(t);
  if(!workspace.enabled||t.organizationId!=='org_default')throw new ForbiddenException('Atualização automática disponível somente na organização homologada.');
  if(action!=='list'&&(!this.enabled()||!workspace.canManage))throw new ForbiddenException('Configuração automática indisponível neste perfil.');
  const body=action==='list'?{}:cceeObject(input,['requestId','reason'],['revision','authorizationId','sourceJobId','monthMode','calendarCode','unit','sourceReference','confirmed','enabled']);
  if(action!=='list')cceeUuid((body as any).requestId);if(id)cceeUuid(id);
  const r=await this.data.rpc('ccee_auto_policy_action',{p_org:t.organizationId,p_actor:t.userId,p_action:action,p_id:id,p_body:body});
  return{...r,canManage:workspace.canManage,enabled:this.enabled()};
 }
 onModuleInit(){if(this.enabled())this.schedule();}
 onModuleDestroy(){this.stopped=true;clearTimeout(this.timer);}
 private schedule(){if(this.stopped)return;this.timer=setTimeout(()=>{void this.runOnce().catch(()=>this.log.warn('CCEE_AUTOMATIC_STEP_UNCONFIRMED')).finally(()=>this.schedule());},30000);this.timer.unref?.();}
 async runOnce(){if(this.stopped||this.busy||!this.enabled())return;this.busy=true;
  try{const db=this.db.getClient();const r=await db.rpc('ccee_auto_claim',{p_org:'org_default',p_private:process.env.CCEE_PRIVATE_READ_ENABLED==='true',p_dri:process.env.CCEE_DRI_READ_ENABLED==='true'});
   if(r.error)throw Error('AUTOMATIC_CLAIM_UNCONFIRMED');if(!r.data)return;
   if(r.data.organizationId!=='org_default')throw Error('AUTOMATIC_SCOPE_CHANGED');
   const plan=servicePolicyPlan(r.data);const saved=await db.rpc('ccee_auto_advance',{p_id:r.data.policy.id,p_lease:r.data.policy.lease_id,p_plan:plan});
   if(saved.error)throw Error('AUTOMATIC_STEP_UNCONFIRMED');
  }finally{this.busy=false;}
 }
}
@Controller('ccee-data/automatic')
export class CceeAutomaticController{
 constructor(private service:CceeAutomaticService){}
 @Get() @Header('Cache-Control','private, no-store') read(@Tenant()t:TenantContext){return this.service.action(t,'list',null);}
 @Post('unit') unit(@Tenant()t:TenantContext,@Body()b:any){const{id,...body}=b??{};return this.service.action(t,'configure_unit',id??null,body);}
 @Post('policies') configure(@Tenant()t:TenantContext,@Body()b:any){const{id,...body}=b??{};return this.service.action(t,'configure',id??null,body);}
 @Post('policies/:id') toggle(@Tenant()t:TenantContext,@Param('id')id:string,@Body()b:unknown){return this.service.action(t,'toggle',id,b);}
}
