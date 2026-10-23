import {BadRequestException,ConflictException,ForbiddenException,Injectable,ServiceUnavailableException} from '@nestjs/common';
import {IsIn,IsISO8601,IsOptional,IsString,IsUUID,Length,Matches} from 'class-validator';
import {SupabaseService} from '../../services/supabase.service';
import {LicensesService} from '../licenses/services/licenses.service';
import {TenantContext} from '../../common/interfaces/tenant-context.interface';
import {PERMISSIONS as P} from '../../common/constants/permissions';
import {validateWriteDto} from '../../common/validation/validate-write-dto';
import {OperationsService} from './operations.service';
import {resolutionId} from '../ocr/ocr-resolution-plan';
export class InvoiceAttentionDto{
 @IsUUID() requestId!:string;
 @IsString() @Matches(/^[a-f0-9]{64}$/) sourceHash!:string;
 @IsIn(['OPENED','DEFERRED','SCHEDULED','PAUSED']) state!:string;
 @IsString() @Length(3,500) note!:string;
 @IsOptional() @IsISO8601({strict:true}) dueAt?:string;
 @IsOptional() @IsString() @Length(1,100) responsibleId?:string;
}
@Injectable()
export class EvaInvoiceAttentionService{
 constructor(private db:SupabaseService,private licenses:LicensesService,private operations:OperationsService){}
 private async allowed(t:TenantContext){
  if(process.env.EVA_GUIDED_REVIEW_ENABLED==='false'||!t?.organizationId||!t.userId||(t.scope as string)==='global'||!['admin_org','gestor','operacional'].includes(t.role)&&t.accessMode!=='platform_operation'||![P.DOCUMENTS_VIEW,P.ORGANIZATION_CONTRACTS_VIEW].every(p=>t.permissions?.includes(p)))throw new ForbiddenException('Conferência disponível ao backoffice autorizado da organização.');
  await this.licenses.requireEntitlement(t.organizationId,'document_management');await this.licenses.requireEntitlement(t.organizationId,'free_market_management');
 }
 private async rpc(action:string,document:string|null,body:any,t:TenantContext){
  const r=await this.db.getClient().rpc('eva_invoice_attention',{p_org:t.organizationId,p_actor:t.userId,p_role:t.roleId,p_platform:t.accessMode==='platform_operation',p_action:action,p_document:document,p_body:body});
  if(!r.error&&r.data!=null)return r.data;
  if(r.error?.code==='42501')throw new ForbiddenException('Fatura indisponível no acesso atual.');
  if(['40001','23505'].includes(r.error?.code))throw new ConflictException('Fonte ou decisão mudou. Consulte a lista antes de continuar.');
  throw new ServiceUnavailableException('Resultado não confirmado. Consulte a lista e a agenda antes de repetir.');
 }
 async list(t:TenantContext){await this.allowed(t);const r=await this.rpc('list',null,{},t);if(!Array.isArray(r.rows))throw new ServiceUnavailableException('Avisos de faturas indisponíveis.');return {...r,organizationId:t.organizationId,canSchedule:[P.OPERACAO_CALENDAR_VIEW,P.OPERACAO_CALENDAR_MANAGE].every(p=>t.permissions.includes(p))};}
 async record(document:string,input:InvoiceAttentionDto,t:TenantContext){
  await this.allowed(t);if(!/^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(document))throw new BadRequestException('Fatura inválida.');
  const d=await validateWriteDto(InvoiceAttentionDto,input);
  if(d.state!=='SCHEDULED'&&(d.dueAt||d.responsibleId))throw new BadRequestException('Data e responsável são exclusivos do agendamento.');
  // Re-read the current authorized source. This never invokes OCR or financial preparation.
  const current=(await this.list(t)).rows.find((r:any)=>r.documentId===document&&r.sourceHash===d.sourceHash);
  if(!current)throw new ConflictException('A origem mudou ou saiu desta lista. Consulte Documentos.');
  let agendaId=null;
  if(d.state==='SCHEDULED'){
   if(![P.OPERACAO_CALENDAR_VIEW,P.OPERACAO_CALENDAR_MANAGE].every(p=>t.permissions.includes(p)))throw new ForbiddenException('Agendar exige consulta e gerenciamento da Agenda.');
   if(!d.dueAt||!d.responsibleId||!Number.isFinite(Date.parse(d.dueAt))||Date.parse(d.dueAt)<=Date.now())throw new BadRequestException('Selecione data e horário futuros e responsável autorizado.');
   const marker='[EVA fatura '+document+' · '+d.sourceHash+']',history=await this.operations.list('agenda',t,{customerId:current.customerId});
   const prior=history.rows.filter((r:any)=>r.document_id===document&&r.description?.startsWith(marker)).sort((a:any,b:any)=>String(b.updated_at).localeCompare(String(a.updated_at))||String(b.id).localeCompare(String(a.id)));
   const active=prior.filter((r:any)=>!['DONE','CANCELLED'].includes(r.status));
   if(active.length){if(active.length!==1||active[0].created_by!==t.userId||active[0].responsible_id!==d.responsibleId||Date.parse(active[0].starts_at)!==Date.parse(d.dueAt))throw new ConflictException('Já existe agendamento ativo desta fatura. Confira ou edite o registro na Agenda.');agendaId=active[0].id;}
   else{
   // Stable per source and completed cycle: concurrent operators cannot create duplicate reminders.
   const agendaRequest=resolutionId(['eva-invoice-agenda-1',t.organizationId,document,d.sourceHash,prior[0]?.id??null,prior[0]?.revision??null]);
   const row=await this.operations.save('agenda',null,{requestId:agendaRequest,revision:0,title:('EVA · conferir fatura · '+current.unitName+' · '+current.month).slice(0,160),description:marker+'\nRetomar conferência das fontes e perguntas atuais. O lembrete não executa OCR, não aplica ajustes, não aprova e não publica valores.\nAbrir: /backoffice/contracts?ocrDocument='+document+'&area=preparation',priority:'NORMAL',responsibleId:d.responsibleId,startsAt:d.dueAt,dueAt:d.dueAt,reason:d.note,customerId:current.customerId,unitId:current.unitId,documentId:document},t);
   agendaId=row.id;
   }
  }
  return this.rpc('record',document,{requestId:d.requestId,sourceHash:d.sourceHash,state:d.state,note:d.note,agendaId},t);
 }
}
