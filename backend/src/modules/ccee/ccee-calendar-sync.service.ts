import {scheduledWorkEnabled} from '../../common/workers/process-role';
import {BadRequestException,Body,Controller,Get,Header,Injectable,Logger,OnModuleDestroy,OnModuleInit,Post,Req} from '@nestjs/common';
import {createHash,randomUUID} from 'node:crypto';
import {SupabaseService} from '../../services/supabase.service';
import {PlatformScope} from '../../common/decorators/platform-scope.decorator';
import {RequirePermission} from '../../common/decorators/require-permission.decorator';
import {RequestWithAuthenticatedUser} from '../../common/interfaces/authenticated-user.interface';
import {TEAM_MANAGE} from '../platform-team/platform-team.permissions';
import {calendarSource,cceeObject,cceeText,cceeUuid,cceeDataEnabled} from './ccee-data.model';
import {downloadCalendar,isolatedCalendar,officialAnnualCalendar} from './ccee-calendar';
import {CceeDataService} from './ccee-data.service';
export function officialCalendarLink(html:string,year:number){
 const urls=new Set<string>();
 for(const match of html.matchAll(/<a\b([^>]+)>([\s\S]*?)<\/a>/gi)){
  const text=match[2].replace(/<[^>]*>/g,' ').replace(/&(?:nbsp|#160);/gi,' ').replace(/&aacute;/gi,'a').replace(/&ccedil;/gi,'c').replace(/&otilde;/gi,'o').replace(/&oacute;/gi,'o').normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/\s+/g,' ').toLowerCase();
  if(!text.includes('calendario geral de operacoes e relatorios')||!text.includes('anual')||!new RegExp('\\b'+year+'\\b').test(text))continue;
  const href=match[1].match(/\bhref\s*=\s*["']([^"']+)["']/i)?.[1];if(href)urls.add(calendarSource(new URL(href.replace(/&amp;/g,'&'),'https://www.ccee.org.br/calendario').toString()));
 }
 if(urls.size!==1)throw Error('CALENDAR_SOURCE_NOT_UNIQUE');return [...urls][0];
}
export async function calendarLanding(transport:typeof fetch=fetch){
 const response=await transport('https://www.ccee.org.br/calendario',{redirect:'error',signal:AbortSignal.timeout(15000)});
 if(!response.ok)throw Error('CALENDAR_INDEX_HTTP_'+response.status);if(!response.body)throw Error('CALENDAR_INDEX_EMPTY_BODY');const reader=response.body.getReader();const parts:Uint8Array[]=[];let size=0;
 try{for(;;){const r=await reader.read();if(r.done)break;size+=r.value.length;if(size>2097152){await reader.cancel();throw Error('CALENDAR_INDEX_SIZE');}parts.push(r.value);}}finally{reader.releaseLock();}
 return Buffer.concat(parts).toString('utf8');
}
@Injectable()
export class CceeCalendarSyncService implements OnModuleInit,OnModuleDestroy{
 private timer?:ReturnType<typeof setTimeout>;private stopped=false;private busy=false;private log=new Logger(CceeCalendarSyncService.name);
 constructor(private db:SupabaseService,private data:CceeDataService){}
 enabled(){return process.env.CCEE_CALENDAR_AUTO_ENABLED==='true'&&process.env.CCEE_OFFICIAL_CALENDAR_ENABLED==='true'&&process.env.CCEE_SYNC_WORKER_ENABLED==='true';}
 async read(actor:string){const r=await this.data.rpc('ccee_calendar_sync_owner',{p_actor:actor,p_action:'read'});return {...r,serverEnabled:this.enabled()};}
 async configure(actor:string,input:unknown){cceeDataEnabled('CCEE_OFFICIAL_CALENDAR_ENABLED');const b=cceeObject(input,['enabled','year','reason','requestId']);cceeUuid(b.requestId);cceeText(b.reason,1000,10);if(typeof b.enabled!=='boolean'||!Number.isInteger(b.year)||b.year<2021||b.year>2099)throw new BadRequestException('Ano ou política de calendário inválidos.');return this.data.rpc('ccee_calendar_sync_owner',{p_actor:actor,p_action:'configure',p_enabled:b.enabled,p_year:b.year,p_reason:b.reason,p_request:b.requestId});}
 onModuleInit(){if(!scheduledWorkEnabled('API'))return;if(this.enabled())this.schedule();}onModuleDestroy(){this.stopped=true;clearTimeout(this.timer);}
 private schedule(){if(this.stopped)return;this.timer=setTimeout(()=>{void this.runOnce().catch(()=>this.log.warn('CCEE_CALENDAR_SYNC_UNCONFIRMED')).finally(()=>this.schedule());},60000);this.timer.unref?.();}
 async runOnce(){if(this.stopped||this.busy||!this.enabled())return;this.busy=true;try{
  const job=await this.data.rpc('ccee_calendar_sync_claim',{});if(!job)return;let source:string|null=null,hash:string|null=null,version:string|null=null,error:string|null=null,stage='identificação da fonte oficial';
  const args={p_org:job.organization_id,p_lease:job.lease_id};
  try{
   if(job.organization_id!=='org_default')throw Error('CALENDAR_ORGANIZATION');
   await this.data.rpc('ccee_calendar_sync_reserve',args);source=officialCalendarLink(await calendarLanding(),job.year);
   stage='download do documento anual';await this.data.rpc('ccee_calendar_sync_reserve',args);const bytes=await downloadCalendar(source);
   try{
    if(bytes.subarray(0,2).toString()!=='PK')throw Error('CALENDAR_XLSX_REQUIRED');hash=createHash('sha256').update(bytes).digest('hex');
    const known=await this.data.rpc('ccee_calendar_sync_lookup',{...args,p_hash:hash});
    if(known){version=known.id;source=known.source_url;}
    else{stage='validação do layout e dos 12 meses';const parsed=officialAnnualCalendar(await isolatedCalendar(bytes),job.year),mapping={adapter:'CCEE_ANNUAL_V9',year:job.year,origin:'OFFICIAL_DAILY_COLLECTION'},normalizedHash=createHash('sha256').update(JSON.stringify({mapping,...parsed})).digest('hex');
     stage='preservação da nova versão';const saved=await this.data.ownerCalendar(job.actor_id,'create',null,{requestId:randomUUID(),sourceUrl:source,sourceHash:hash,normalizedHash,year:job.year,mapping,coverage:parsed.coverage,issues:parsed.issues,items:parsed.items,reason:'Coleta diária do calendário público oficial CCEE; fonte preservada para revisão independente.'});version=saved.id;
    }
   }finally{bytes.fill(0);}
  }catch(e){const diagnostic=e instanceof Error&&/^CALENDAR_(?:INDEX_(?:HTTP_[0-9]{3}|EMPTY_BODY|SIZE)|SOURCE_NOT_UNIQUE|XLSX_REQUIRED|ORGANIZATION)$/.test(e.message)?' Código '+e.message+'.':'';error='Coleta não concluída na etapa de '+stage+'.'+diagnostic+' Confira a fonte do ano '+job.year+'; a versão anterior foi preservada.';this.log.warn('CCEE_CALENDAR_SOURCE_REQUIRES_REVIEW');}
  await this.data.rpc('ccee_calendar_sync_finish',{...args,p_source:source,p_hash:hash,p_version:version,p_error:error});
 }finally{this.busy=false;}}
}
@Controller('admin/integrations/ccee-calendar-sync') @PlatformScope()
export class CceeCalendarSyncController{
 constructor(private readonly sync:CceeCalendarSyncService){}
 @Get() @Header('Cache-Control','private, no-store') @RequirePermission([TEAM_MANAGE]) read(@Req()req:RequestWithAuthenticatedUser){return this.sync.read(req.authenticatedUser.userId);}
 @Post() @RequirePermission([TEAM_MANAGE]) configure(@Req()req:RequestWithAuthenticatedUser,@Body()body:unknown){return this.sync.configure(req.authenticatedUser.userId,body);}
}
