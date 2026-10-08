import {ForbiddenException,Injectable} from '@nestjs/common';
import {OperationsService} from '../operations/operations.service';
import {TenantContext} from '../../common/interfaces/tenant-context.interface';
import {PERMISSIONS as P} from '../../common/constants/permissions';

@Injectable()
export class BotEnergyAgendaService {
 constructor(private readonly operations:OperationsService){}
 async reminders(t:TenantContext,now=new Date()){
  if(!t?.organizationId||!t.userId||(t.scope as string)==='global'||!['admin_org','gestor','operacional'].includes(t.role)&&t.accessMode!=='platform_operation'||![P.OPERACAO_CALENDAR_VIEW,P.ORGANIZATION_CUSTOMERS_VIEW,P.ORGANIZATION_CONSUMER_UNITS_VIEW].every(p=>t.permissions?.includes(p)))throw new ForbiddenException('Avisos exigem agenda e contexto de clientes do backoffice autorizado.');
  // OperationsService checks the current plan, tenant and record visibility again.
  const day=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit'}).format(now);
  // A deadline may differ from the event start; never filter by start and miss a closure.
  // The existing reader fails closed above its bounded complete result limit.
  const {rows}=await this.operations.list('agenda',t);
  const reminders=rows.filter((r:any)=>r.organization_id===t.organizationId&&r.customer_id&&r.consumer_unit_id&&!['DONE','CANCELLED'].includes(r.status)).flatMap((r:any)=>{
   const deadline=r.due_at||r.starts_at,time=Date.parse(deadline);
   if(!Number.isFinite(time))return [];
   const dueDay=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(time));
   const days=Math.round((Date.parse(dueDay+'T00:00:00Z')-Date.parse(day+'T00:00:00Z'))/86400000);
   if(days>7||days< -30)return [];
   const stage=days<0?'OVERDUE':days===0?'TODAY':days<=1?'ONE_DAY':days<=3?'THREE_DAYS':'SEVEN_DAYS';
   return [{key:r.id+':'+r.revision+':'+stage,id:r.id,title:r.title,deadline,days,stage,responsibleId:r.responsible_id,customerId:r.customer_id,unitId:r.consumer_unit_id,source:'Agenda registrada da organização · revisão '+r.revision,href:'/backoffice/operation/agenda'}];
  }).sort((a:any,b:any)=>a.deadline.localeCompare(b.deadline));
  return {organizationId:t.organizationId,checkedAt:now.toISOString(),reminders,disclosure:'Bot-Energy acompanha prazos registrados por cliente e unidade. Confira a fonte e o calendário oficial CCEE; marcar um aviso como lido não conclui o fechamento nem comprova cumprimento. Este aviso interno não envia mensagens externas.'};
 }
}
