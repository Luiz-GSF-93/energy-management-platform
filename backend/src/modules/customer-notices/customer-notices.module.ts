import {BadRequestException,Body,ConflictException,Controller,ForbiddenException,Get,Injectable,InternalServerErrorException,Logger,Module,OnModuleDestroy,OnModuleInit,Post} from '@nestjs/common';
import {IsBoolean,IsInt,IsObject,IsOptional,IsUUID,Min} from 'class-validator';
import {Tenant} from '../../common/decorators/tenant.decorator';
import {TenantContext} from '../../common/interfaces/tenant-context.interface';
import {validateWriteDto} from '../../common/validation/validate-write-dto';
import {SupabaseService} from '../../services/supabase.service';
import {WhatsappTemplatesService} from '../whatsapp-delivery/whatsapp-templates.service';
import {noticeReady,sendCustomerNotice} from './customer-notice.transport';
class NoticePolicyDto{
 @IsOptional() @IsUUID() id?:string;
 @IsOptional() @IsInt() @Min(1) expectedVersion?:number;
 @IsUUID() requestId!:string;
 @IsObject() config!:Record<string,unknown>;
 @IsBoolean() enabled!:boolean;
}
@Injectable()
export class CustomerNoticesService{
 constructor(private db:SupabaseService,private templates:WhatsappTemplatesService){}
 private async rpc(name:string,args:Record<string,unknown>){const r=await this.db.getClient().rpc(name,args);if(r.error){if(r.error.code==='42501')throw new ForbiddenException('Avisos exigem permissões vigentes de notificações, clientes, unidades, agenda e solicitações.');if(['40001','23505'].includes(r.error.code))throw new ConflictException('A configuração ou os contatos mudaram. Salve pausada e revise antes de ativar.');if(['22023','P3862','23514'].includes(r.error.code))throw new BadRequestException('Confira cliente, unidade, eventos e canais autorizados dos contatos.');throw new InternalServerErrorException('Avisos indisponíveis.');}return r.data;}
 private access(t:TenantContext){if(!t?.organizationId||!t.userId||(t.scope as string)==='global'||(!['admin_org','gestor','operacional'].includes(t.role)&&t.accessMode!=='platform_operation')||!t.permissions?.includes('51da7cca-8196-4135-84ce-f989be5ee594'))throw new ForbiddenException('Configuração restrita ao backoffice da organização.');}
 async read(t:TenantContext){this.access(t);const data=await this.rpc('read_customer_notices',{p_org:t.organizationId,p_actor:t.userId}),templates=await this.templates.inspect();return {...data,providers:{enabled:process.env.CUSTOMER_NOTICES_ENABLED==='true',email:noticeReady('email','REQUEST'),sms:noticeReady('sms','REQUEST'),whatsapp:Object.fromEntries(['REQUEST','AGENDA','DEADLINE','ACL_PUBLISHED'].map(e=>[e,noticeReady('whatsapp',e,templates)]))}};}
 async save(input:unknown,t:TenantContext){this.access(t);const d=await validateWriteDto(NoticePolicyDto,input as NoticePolicyDto);if(Boolean(d.id)!==Boolean(d.expectedVersion))throw new BadRequestException('Informe a versão da configuração.');return this.rpc('save_customer_notice_policy',{p_org:t.organizationId,p_actor:t.userId,p_id:d.id??null,p_version:d.expectedVersion??null,p_request:d.requestId,p_config:d.config,p_enabled:d.enabled});}
}
@Controller('customer-notices')
export class CustomerNoticesController{
 constructor(private service:CustomerNoticesService){}
 @Get() read(@Tenant() t:TenantContext){return this.service.read(t);}
 @Post() save(@Body() d:NoticePolicyDto,@Tenant() t:TenantContext){return this.service.save(d,t);}
}
@Injectable()
export class CustomerNoticeWorker implements OnModuleInit,OnModuleDestroy{
 private timer?:ReturnType<typeof setTimeout>;private stopped=false;private busy=false;private logger=new Logger(CustomerNoticeWorker.name);
 constructor(private db:SupabaseService,private templates:WhatsappTemplatesService){}
 onModuleInit(){if(process.env.CUSTOMER_NOTICES_ENABLED==='true')this.schedule();}
 onModuleDestroy(){this.stopped=true;if(this.timer)clearTimeout(this.timer);}
 private schedule(){if(this.stopped)return;this.timer=setTimeout(()=>{void this.runOnce().catch(()=>this.logger.warn('CUSTOMER_NOTICE_PENDING')).finally(()=>this.schedule());},15000);this.timer.unref?.();}
 async runOnce(){if(this.stopped||this.busy||process.env.CUSTOMER_NOTICES_ENABLED!=='true')return;this.busy=true;try{
  const templates=await this.templates.inspect(),channels=['email','sms','whatsapp'].filter(c=>['REQUEST','AGENDA','DEADLINE','ACL_PUBLISHED'].every(e=>noticeReady(c,e,templates)));
  if(!channels.length)return;const client=this.db.getClient(),claim=await client.rpc('claim_customer_notice',{p_channels:channels});if(claim.error)throw Error('NOTICE_CLAIM_UNAVAILABLE');if(!claim.data)return;const d=claim.data;
  if(!channels.includes(d.channel)||typeof d.organization_id!=='string'||!d.lease_id)throw Error('NOTICE_SCOPE_INVALID');
  const start=await client.rpc('start_customer_notice',{p_org:d.organization_id,p_id:d.id,p_lease:d.lease_id});if(start.error)throw Error('NOTICE_REVALIDATION_FAILED');if(start.data!==true)return;
  const result=await sendCustomerNotice(d,templates),finish=await client.rpc('finish_customer_notice',{p_org:d.organization_id,p_id:d.id,p_lease:d.lease_id,p_state:result.state,p_provider:result.providerId??null,p_reason:result.reason??null});if(finish.error)throw Error('NOTICE_FINISH_UNAVAILABLE');
 }finally{this.busy=false;}}
}
@Module({controllers:[CustomerNoticesController],providers:[CustomerNoticesService,CustomerNoticeWorker,SupabaseService,WhatsappTemplatesService]})
export class CustomerNoticesModule{}
