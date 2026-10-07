import {BadRequestException,ConflictException,ForbiddenException,Injectable,InternalServerErrorException,NotFoundException} from '@nestjs/common';
import {SupabaseService} from '../../services/supabase.service';
import {TenantContext} from '../../common/interfaces/tenant-context.interface';
import {PERMISSIONS as P} from '../../common/constants/permissions';
import {validateWriteDto} from '../../common/validation/validate-write-dto';
import {ReportsService} from './reports.service';
import {ReportPolicyStateDto,SaveReportPolicyDto} from './report-policy.dto';
import {reportPolicy} from './report-policy';
import {reportProviderReady} from './report-delivery';
@Injectable()
export class ReportPolicyService{
 constructor(private db:SupabaseService,private reports:ReportsService){}
 private async rpc(name:string,args:Record<string,unknown>){const r=await this.db.getClient().rpc(name,args);if(r.error){if(r.error.code==='42501')throw new ForbiddenException('Configuração exige licença e permissão de notificações vigentes.');if(r.error.code==='40001')throw new ConflictException('A configuração ou os contatos mudaram. Revise e salve novamente.');if(r.error.code==='P3862')throw new NotFoundException('Cliente, unidade ou política indisponível.');if(['22023','23514'].includes(r.error.code))throw new BadRequestException('Revise a configuração e os canais autorizados dos contatos.');throw new InternalServerErrorException('Configuração de relatórios indisponível.');}return r.data;}
 async access(t:TenantContext){if(!t.permissions?.includes(P.SETTINGS_NOTIFICATIONS_MANAGE))throw new ForbiddenException('Configuração exige permissão de notificações.');await this.reports.access(t,true);}
 async list(t:TenantContext,search=''){await this.access(t);if(typeof search!=='string'||search.length>100||/[\u0000-\u001f\u007f]/.test(search))throw new BadRequestException('Busca de cliente inválida.');const data=await this.rpc('read_report_configuration',{p_org:t.organizationId,p_actor:t.userId,p_search:search.trim()});const deliveries=await this.rpc('read_report_deliveries',{p_org:t.organizationId,p_actor:t.userId});return {...data,deliveries,providers:{enabled:process.env.REPORTS_DELIVERY_ENABLED==='true',email:reportProviderReady('email'),whatsapp:reportProviderReady('whatsapp'),sms:reportProviderReady('sms')}};}
 async save(input:unknown,t:TenantContext){await this.access(t);const d=await validateWriteDto<SaveReportPolicyDto>(SaveReportPolicyDto,input as SaveReportPolicyDto);if(Boolean(d.id)!==Boolean(d.expectedVersion))throw new BadRequestException('Informe a versão da política em edição.');return this.rpc('save_report_policy',{p_org:t.organizationId,p_actor:t.userId,p_id:d.id??null,p_version:d.expectedVersion??null,p_request:d.requestId,p_config:reportPolicy(d.config)});}
 async state(id:string,input:unknown,t:TenantContext){await this.access(t);const d=await validateWriteDto<ReportPolicyStateDto>(ReportPolicyStateDto,input as ReportPolicyStateDto);return this.rpc('set_report_policy_state',{p_org:t.organizationId,p_actor:t.userId,p_id:id,p_version:d.expectedVersion,p_request:d.requestId,p_enabled:d.enabled});}
}
