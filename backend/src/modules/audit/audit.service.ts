import {BadRequestException,ForbiddenException,Injectable,ServiceUnavailableException,Logger} from '@nestjs/common';
import {createHmac,randomUUID} from 'crypto';
import {ConfigService} from '@nestjs/config';
import {SupabaseService} from '../../services/supabase.service';
import {RequestWithTenant} from '../../common/interfaces/tenant-context.interface';
import {auditFilters,safeText} from './audit.model';
@Injectable()
export class AuditWorkspaceService{
 private readonly logger=new Logger('AuditCapture');private failures=0;private readonly captureClient:any;
 constructor(private readonly db:SupabaseService,private readonly config:ConfigService){this.captureClient=db.createAuthClient();}
 private actor(r:RequestWithTenant,global:boolean){const t=r.accessContext??r.tenantContext;
 if(!t||(global?t.scope!=='global':t.scope==='global'))throw new ForbiddenException('Contexto de auditoria inválido.');
 return {t,org:global?null:(t as any).organizationId,user:t.userId};}
 private async rpc(name:string,args:any){const {data,error}=await this.db.getClient().rpc(name,args);if(error){if(error.code==='42501')throw new ForbiddenException('Auditoria exige licença e permissão específicas.');if(error.code==='22023')throw new BadRequestException('Revise os filtros e a justificativa.');throw new ServiceUnavailableException('Auditoria indisponível. Nenhum registro ausente foi considerado zero.');}return data;}
 async read(r:RequestWithTenant,global:boolean,q:Record<string,unknown>){const a=this.actor(r,global),f=auditFilters(q);if(!global&&f.organization)throw new ForbiddenException('O escopo é definido pela sessão.');return {...await this.rpc('energy_audit_read',{p_org:a.org,p_actor:a.user,p_global:global,p_filters:f}),captureHealth:{localFailures:global?this.failures:null},updatedAt:new Date().toISOString()};}
 async alertCount(r:RequestWithTenant,global:boolean){const a=this.actor(r,global);return this.rpc('energy_audit_alert_count',{p_org:a.org,p_actor:a.user,p_global:global});}
 async evidence(r:RequestWithTenant,global:boolean,id:string,q:Record<string,unknown>){const a=this.actor(r,global);const page=Number(q.page??0);if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)||Object.keys(q).some(k=>k!=='page')||!Number.isInteger(page)||page<0||page>10000)throw new BadRequestException('Alerta ou página inválidos.');return this.rpc('energy_audit_alert_evidence',{p_org:a.org,p_actor:a.user,p_global:global,p_id:id,p_page:page});}
 async decide(r:RequestWithTenant,global:boolean,id:string,b:any){const a=this.actor(r,global);if(!/^[0-9a-f-]{36}$/i.test(id)||!b||Object.keys(b).some(k=>!['state','reason'].includes(k))||!['ANALYSIS','RESOLVED','FALSE_POSITIVE'].includes(b.state)||typeof b.reason!=='string'||b.reason.trim().length<10||b.reason.length>1000)throw new BadRequestException('Informe uma decisão e justificativa de 10 a 1.000 caracteres.');return this.rpc('energy_audit_decide',{p_org:a.org,p_actor:a.user,p_global:global,p_id:id,p_state:b.state,p_reason:safeText(b.reason,1000)});}
 async retention(r:RequestWithTenant,global:boolean){const a=this.actor(r,global);return this.rpc('energy_audit_retention_read',{p_org:a.org,p_actor:a.user,p_global:global});}
 async retentionAct(r:RequestWithTenant,b:any){const a=this.actor(r,true);
 if(!b||Object.keys(b).some(k=>!['action','data'].includes(k))||!['HOLD','RELEASE_HOLD','APPROVE_MOVE','EXECUTE_MOVE','REQUEST_RESTORE'].includes(b.action)||!b.data||typeof b.data!=='object'||Array.isArray(b.data)||JSON.stringify(b.data).length>12000||Object.keys(b.data).some(k=>!['organization','source','sourceId','reason','basis','reviewAt','id','ids'].includes(k)))throw new BadRequestException('Decisão de retenção inválida.');
 return this.rpc('energy_audit_retention_act',{p_actor:a.user,p_action:b.action,p_data:b.data});}
 private session(r:RequestWithTenant){const t=r.accessContext??r.tenantContext;if(!t)return null;
 const token=String(r.headers.authorization??'').replace(/^Bearer /i,'');try{const p=JSON.parse(Buffer.from(token.split('.')[1],'base64url').toString());if(p.sub!==t.userId||typeof p.session_id!=='string'||!Number.isFinite(p.exp))return null;const key=this.config.get<string>('SUPABASE_SERVICE_KEY');if(!key)return null;return {id:createHmac('sha256',key).update('energy-audit-session:'+p.session_id).digest('hex'),expires:new Date(p.exp*1000).toISOString()};}catch{return null;}}
 async presence(r:RequestWithTenant,b:any){const t=r.accessContext??r.tenantContext;if(!t||t.role==='consulta')throw new ForbiddenException('Presença exclusiva do backoffice.');
 if(!b||Object.keys(b).some(k=>!['module','stop','visit'].includes(k))||typeof b.module!=='string'||!/^\/backoffice(?:\/[a-z0-9-]+){0,4}$/.test(b.module)||b.stop!==undefined&&typeof b.stop!=='boolean'||b.visit!==undefined&&typeof b.visit!=='boolean')throw new BadRequestException('Presença inválida.');
 const s=this.session(r);if(!s)return {observed:false};return this.rpc('energy_audit_presence',{p_org:t.scope==='global'?null:(t as any).organizationId,p_actor:t.userId,p_session:s.id,p_expires:s.expires,p_module:b.module,p_stop:b.stop===true,p_visit:b.visit===true});}
 async capture(r:RequestWithTenant,status:number,duration:number){
 const t=r.accessContext??r.tenantContext;const route=String(r.route?.path??'');if(route.includes('audit')||r.method==='OPTIONS')return;
 // Routine playback ticks are compacted into the private progress row. Failed requests remain auditable.
 if(status<400&&route.endsWith('/training/ccee/progress')&&r.body?.action==='TICK')return;
 const authPath=/\/auth\/(login|refresh|accept-invite)$/.test(route);if(!t&&!authPath&&status<400)return;
 const sourceIp=r.socket?.remoteAddress??null; // Connection address only. Never trust arbitrary forwarding headers.
 const key=this.config.get<string>('SUPABASE_SERVICE_KEY');const origin=sourceIp&&key?createHmac('sha256',key).update('audit-origin:'+sourceIp).digest('hex'):null;
 const path=route.replace(/[^a-zA-Z0-9/:_.-]/g,'').slice(0,180)||'unresolved-route';
 const event={id:(r as any).auditCorrelation??randomUUID(),organization_id:t&&t.scope!=='global'?(t as any).organizationId:null,actor_id:t?.userId??null,role:t?.role??null,module:path.split('/').filter(Boolean).filter(x=>!['api','v1','admin'].includes(x))[0]??'system',action:authPath?(status<400?'LOGIN':'AUTH_FAILURE'):r.method==='GET'&&status<400&&/download$/.test(route)?'DOWNLOAD_REQUEST':r.method==='GET'?'READ':r.method,resource:path,result:status<400?'SUCCESS':status===401?'AUTH_FAILURE':status===403?'DENIED':status>=500?'CRITICAL':'ERROR',status_code:status,duration_ms:Math.min(duration,3600000),ip:sourceIp,ip_basis:sourceIp?'CONNECTION_ONLY':null,origin,session_id:this.session(r)?.id??null,release:safeText(this.config.get('RAILWAY_GIT_COMMIT_SHA')??this.config.get('VERCEL_GIT_COMMIT_SHA'),80),reason:null};
 try{const {error}=await this.captureClient.rpc('energy_audit_capture',{p_event:event});if(error)throw error;}catch{this.failures++;this.logger.error('Audit capture unavailable; operation outcome unchanged.');}
 }
}
