import {sourceNotification,SourceOrigin} from './source-notifications';
import {BadRequestException,ConflictException,ForbiddenException,Injectable,InternalServerErrorException,NotFoundException} from '@nestjs/common';
import {SupabaseService} from '../../services/supabase.service';
import {LicensesService} from '../licenses/services/licenses.service';
import {PERMISSIONS as P} from '../../common/constants/permissions';
import {TenantContext} from '../../common/interfaces/tenant-context.interface';
import {validateWriteDto} from '../../common/validation/validate-write-dto';
import {OperationWriteDto,OperationTransitionDto,NotificationReadDto} from './operations.dto';
export const operationPermissions={agenda:[P.OPERACAO_CALENDAR_VIEW,P.OPERACAO_CALENDAR_MANAGE],requests:[P.OPERACAO_REQUESTS_VIEW,P.OPERACAO_REQUESTS_MANAGE],events:[P.OPERACAO_EVENTS_VIEW,P.OPERACAO_EVENTS_MANAGE]} as const;
export type OperationKind=keyof typeof operationPermissions;
export function operationKind(value:string):OperationKind{if(!Object.prototype.hasOwnProperty.call(operationPermissions,value))throw new BadRequestException('Área operacional inválida.');return value as OperationKind;}
export function operationTransition(kind:OperationKind,old:string,next:string){
 const transitions:Record<string,string[]> = kind==='events'?{DRAFT:['REVIEW'],REVIEW:['DRAFT','PUBLISHED'],PUBLISHED:['ARCHIVED']}:{OPEN:['IN_PROGRESS','WAITING','DONE','CANCELLED'],IN_PROGRESS:['WAITING','DONE','CANCELLED'],WAITING:['IN_PROGRESS','DONE','CANCELLED']};
 return (transitions[old]??[]).includes(next);
}
@Injectable()
export class OperationsService {
 constructor(private db:SupabaseService,private licenses:LicensesService){}
 private client(){return this.db.getClient();}
 private fail(error:any){if(!error)return;if(error.code==='42501')throw new ForbiddenException('Acesso à solicitação ACL indisponível no vínculo atual.');if(['P2031','23514','23502'].includes(error.code))throw new BadRequestException('Confira vínculos, responsável, prazo e estado operacional.');if(['P2032','23505'].includes(error.code))throw new ConflictException('O registro ou a solicitação mudou. Atualize o histórico antes de repetir.');if(error.code==='P2033')throw new NotFoundException('Registro indisponível nesta organização.');throw new InternalServerErrorException('Não foi possível consultar ou salvar a operação.');}
 private async allowed(t:TenantContext,permission:string,write=false){
  if(!t?.organizationId||!t.userId||(t.scope as string)==='global'||(!['admin_org','gestor','operacional'].includes(t.role)&&t.accessMode!=='platform_operation')||!t.permissions?.includes(permission))throw new ForbiddenException('Operação exige perfil backoffice e permissão desta área na organização ativa.');
  await this.licenses.requireEntitlement(t.organizationId,'free_market_management');
 }
 private async visible(rows:any[],t:TenantContext,write=false){
  if(!rows.length)return rows;
  const r=await this.client().rpc('acl_operation_visible',{p_org:t.organizationId,p_actor:t.userId,p_records:rows.map(v=>v.id),p_write:write});this.fail(r.error);
  if(!Array.isArray(r.data)||r.data.some((id:any)=>!rows.some(v=>v.id===id)))throw new InternalServerErrorException('Não foi possível conferir o escopo ACL.');
  const ids=new Set(r.data);return rows.filter(v=>ids.has(v.id));
 }
 private async scope(t:TenantContext,d:OperationWriteDto){
  if(d.unitId&&!d.customerId)throw new BadRequestException('Selecione o cliente da unidade.');
  if(d.customerId){const c=await this.client().from('customers').select('id').eq('organization_id',t.organizationId).eq('id',d.customerId).is('deleted_at',null).maybeSingle();this.fail(c.error);if(!c.data)throw new NotFoundException('Cliente indisponível nesta organização.');}
  if(d.unitId){const u=await this.client().from('consumer_units').select('id').eq('organization_id',t.organizationId).eq('customer_id',d.customerId).eq('id',d.unitId).maybeSingle();this.fail(u.error);if(!u.data)throw new NotFoundException('Unidade indisponível para este cliente.');}
  if(d.documentId){if(!t.permissions.includes(P.DOCUMENTS_VIEW))throw new ForbiddenException('Anexar documento exige permissão de leitura.');const doc=await this.client().from('documents').select('id,customer_id,consumer_unit_id,file_verified').eq('organization_id',t.organizationId).eq('id',d.documentId).maybeSingle();this.fail(doc.error);if(!doc.data||!doc.data.file_verified||doc.data.customer_id!==d.customerId||(d.unitId&&doc.data.consumer_unit_id!==d.unitId))throw new BadRequestException('Selecione um documento privado recebido do mesmo cliente e unidade.');}
  if(d.responsibleId!==t.userId){const m=await this.client().from('organization_members').select('user_id,roles(name)').eq('organization_id',t.organizationId).eq('user_id',d.responsibleId).eq('status','ACTIVE').maybeSingle();this.fail(m.error);const role=Array.isArray(m.data?.roles)?m.data.roles[0]:m.data?.roles;if(!m.data||!['admin_org','gestor','operacional'].includes(role?.name))throw new BadRequestException('Responsável deve ter vínculo backoffice ativo nesta organização.');}
  if(d.startsAt&&d.endsAt&&Date.parse(d.endsAt)<=Date.parse(d.startsAt))throw new BadRequestException('O término deve ser posterior ao início.');
 }
 async list(kindValue:string,t:TenantContext,query:{from?:string;to?:string;customerId?:string}={}){
  const kind=operationKind(kindValue);await this.allowed(t,operationPermissions[kind][0]);
  if(Object.keys(query).some(k=>!['from','to','customerId'].includes(k)))throw new BadRequestException('Filtro inválido.');
  for(const v of [query.from,query.to])if(v&&(!/^\d{4}-\d{2}-\d{2}$/.test(v)||!Number.isFinite(Date.parse(v))))throw new BadRequestException('Período inválido.');
  if(query.from&&query.to&&query.to<query.from)throw new BadRequestException('Período invertido.');
  if(query.customerId&&!/^[a-f0-9-]{36}$/i.test(query.customerId))throw new BadRequestException('Cliente inválido.');
  let q=this.client().from('operation_records').select('*').eq('organization_id',t.organizationId).eq('kind',kind);
  if(query.from)q=q.gte('effective_date',query.from);if(query.to)q=q.lte('effective_date',query.to);if(query.customerId)q=q.eq('customer_id',query.customerId);
  const r=await q.order('effective_date',{ascending:true}).order('id').limit(201);this.fail(r.error);if(!Array.isArray(r.data)||r.data.length>200)throw new BadRequestException('Reduza o período ou selecione um cliente; nenhum conjunto parcial foi emitido.');
  if(r.data.some((v:any)=>v.organization_id!==t.organizationId||v.kind!==kind))throw new InternalServerErrorException('Registro fora do escopo.');
  return {rows:await this.visible(r.data,t),canManage:t.permissions.includes(operationPermissions[kind][1]),canPublish:['admin_org','gestor'].includes(t.role)||t.accessMode==='platform_operation'};
 }
 async one(id:string,kindValue:string,t:TenantContext,write=false){const kind=operationKind(kindValue);await this.allowed(t,operationPermissions[kind][0]);const r=await this.client().from('operation_records').select('*').eq('organization_id',t.organizationId).eq('kind',kind).eq('id',id).maybeSingle();this.fail(r.error);if(!r.data||(await this.visible([r.data],t,write)).length!==1)throw new NotFoundException('Registro indisponível nesta organização.');return r.data;}
 async history(id:string,kind:string,t:TenantContext){await this.one(id,kind,t);const r=await this.client().from('operation_record_history').select('revision,action,actor_id,reason,recorded_at,snapshot').eq('organization_id',t.organizationId).eq('record_id',id).order('revision',{ascending:false}).limit(201);this.fail(r.error);if(!Array.isArray(r.data)||r.data.length>200)throw new BadRequestException('Histórico extenso; consulte a equipe de gestão.');return r.data;}
 async save(kindValue:string,id:string|null,input:OperationWriteDto,t:TenantContext){const kind=operationKind(kindValue);await this.allowed(t,operationPermissions[kind][1],true);const d=await validateWriteDto(OperationWriteDto,input);if((!id&&d.revision!==0)||(id&&d.revision<1))throw new BadRequestException('Revisão inválida.');if(kind==='requests'&&(!d.dueAt||!d.customerId||!d.requestType))throw new BadRequestException('Solicitação exige cliente, prazo e tipo.');if(kind==='agenda'&&!d.startsAt)throw new BadRequestException('Agenda exige data e horário.');await this.scope(t,d);const r=await this.client().rpc('save_operation_record',{p_org:t.organizationId,p_actor:t.userId,p_kind:kind,p_id:id,p_request:d.requestId,p_revision:d.revision,p_reason:d.reason.trim(),p_data:d});this.fail(r.error);return r.data;}
 async transition(id:string,kindValue:string,input:OperationTransitionDto,t:TenantContext){const kind=operationKind(kindValue);await this.allowed(t,operationPermissions[kind][1],true);const d=await validateWriteDto(OperationTransitionDto,input);if(d.status==='PUBLISHED'&&!(['admin_org','gestor'].includes(t.role)||t.accessMode==='platform_operation'))throw new ForbiddenException('Publicação exige Gestor ou Administrador.');const r=await this.client().rpc('transition_operation_record',{p_org:t.organizationId,p_actor:t.userId,p_kind:kind,p_id:id,p_request:d.requestId,p_revision:d.revision,p_reason:d.reason.trim(),p_status:d.status});this.fail(r.error);return r.data;}
 async responsible(t:TenantContext){const p=Object.values(operationPermissions).map((v:any)=>v[0]).find(v=>t.permissions?.includes(v));await this.allowed(t,p??'');const r=await this.client().from('organization_members').select('user_id,display_name,roles(name)').eq('organization_id',t.organizationId).eq('status','ACTIVE').limit(201);this.fail(r.error);if(!Array.isArray(r.data)||r.data.length>200)throw new BadRequestException('Lista de responsáveis extensa.');return r.data.filter((v:any)=>{const role=Array.isArray(v.roles)?v.roles[0]:v.roles;return ['admin_org','gestor','operacional'].includes(role?.name);}).map((v:any)=>({id:v.user_id,name:v.display_name||'Usuário '+v.user_id.slice(0,8)}));}
 async notifications(t:TenantContext,includeSources=false){
  const kinds=(Object.keys(operationPermissions) as OperationKind[]).filter(k=>t.permissions?.includes(operationPermissions[k][0]));if(!kinds.length)throw new ForbiddenException('Sem acesso à operação.');await this.allowed(t,operationPermissions[kinds[0]][0]);
  const [items,reads]=await Promise.all([this.client().from('operation_records').select('*').eq('organization_id',t.organizationId).in('kind',kinds).not('status','in','(DONE,CANCELLED,ARCHIVED)').order('updated_at',{ascending:false}).limit(201),this.client().from('operation_notification_reads').select('notification_key').eq('organization_id',t.organizationId).eq('user_id',t.userId).limit(1001)]);this.fail(items.error);this.fail(reads.error);if(!Array.isArray(items.data)||items.data.length>200||!Array.isArray(reads.data)||reads.data.length>1000)throw new BadRequestException('Caixa extensa; use os filtros operacionais.');
  const keys=new Set(reads.data.map((v:any)=>v.notification_key)),now=Date.now();const operational=(await this.visible(items.data,t)).map((v:any)=>({key:v.id+':'+v.revision,title:v.title,priority:v.priority,date:v.updated_at,dueAt:v.due_at,overdue:!!v.due_at&&Date.parse(v.due_at)<now,origin:v.kind,status:v.status,read:keys.has(v.id+':'+v.revision),href:'/backoffice/operation/'+v.kind,id:v.id}));
  const sourceRows=includeSources?await this.sourceAlerts(t):[];
  if(operational.length+sourceRows.length>200)throw new BadRequestException('Caixa extensa; consulte os módulos de origem. Nenhum conjunto parcial foi emitido.');
  return {rows:[...operational,...sourceRows.map(v=>({...v,read:keys.has(v.key)}))].sort((a,b)=>String(b.date).localeCompare(String(a.date))),disclosure:'Alertas internos de Operação, OCR, contratos e licença, conforme as permissões. Leitura não resolve pendências nem aprova dados financeiros.'};
 }
 private async sourceAlerts(t:TenantContext){
  const now=new Date(),today=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit'}).format(now);
  const min=new Date(Date.parse(today+'T00:00:00Z')-30*86400000).toISOString().slice(0,10),max=new Date(Date.parse(today+'T00:00:00Z')+31*86400000).toISOString().slice(0,10);
  const sources:{origin:SourceOrigin;query:any}[]=[];
  let documentsAllowed=false;if(t.permissions.includes(P.DOCUMENTS_VIEW)){try{await this.licenses.requireEntitlement(t.organizationId,'document_management');documentsAllowed=true;}catch(e){if(!(e instanceof ForbiddenException))throw e;}}
  if(documentsAllowed){sources.push({origin:'ocr',query:this.client().from('document_ocr_jobs').select('id,organization_id,document_id,state,updated_at,created_at,documents!inner(original_filename,file_verified,organization_id)').eq('organization_id',t.organizationId).in('state',['SUCCEEDED','FAILED','SUBMISSION_UNKNOWN']).gte('updated_at',new Date(now.getTime()-7*86400000).toISOString()).order('updated_at',{ascending:false}).limit(201)});}
  if(t.permissions.includes(P.ORGANIZATION_CONTRACTS_VIEW))for(const [origin,table] of [['energy','energy_contracts'],['management','management_contracts']] as const)sources.push({origin,query:this.client().from(table).select('id,organization_id,contract_number,status,end_date,updated_at,created_at').eq('organization_id',t.organizationId).eq('status','ACTIVE').gte('end_date',min).lt('end_date',max).order('end_date').limit(201)});
  if(t.permissions.includes(P.ORGANIZATION_LICENSES_VIEW))sources.push({origin:'license',query:this.client().from('licenses').select('id,organization_id,status,active,end_date,renewal_date,updated_at,created_at').eq('organization_id',t.organizationId).eq('status','ACTIVE').eq('active',true).limit(201)});
  const results=await Promise.all(sources.map(async source=>{const r=await source.query;this.fail(r.error);if(!Array.isArray(r.data)||r.data.length>200)throw new BadRequestException('Origem de alertas extensa; nenhum conjunto parcial foi emitido.');if(r.data.some((v:any)=>v.organization_id!==t.organizationId))throw new InternalServerErrorException('Alerta fora do escopo.');return r.data.map((v:any)=>sourceNotification(source.origin,v,today)).filter((v:ReturnType<typeof sourceNotification>):v is NonNullable<ReturnType<typeof sourceNotification>>=>v!==null);}));
  return results.flat();
 }
 async markRead(input:NotificationReadDto,t:TenantContext){const d=await validateWriteDto(NotificationReadDto,input),n=await this.notifications(t,true);if(!n.rows.some((r:{key:string})=>r.key===d.key))throw new NotFoundException('Notificação fora do escopo atual.');const r=await this.client().rpc(/^(ocr|energy|management|license):/.test(d.key)?'read_source_operation_notification':'read_operation_notification',{p_org:t.organizationId,p_actor:t.userId,p_key:d.key});this.fail(r.error);return {read:true};}
}
