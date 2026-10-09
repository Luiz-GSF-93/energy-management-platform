import {PERMISSIONS as P} from '../../common/constants/permissions';
import {Injectable} from '@nestjs/common';
import {createHash,randomUUID} from 'node:crypto';
import {TenantContext} from '../../common/interfaces/tenant-context.interface';
import {AuditService} from '../../common/services/audit.service';
import {BotEnergyBudgetService} from '../ocr/bot-energy-budget.service';
import {BotEnergyLicenseService} from '../ocr/bot-energy-license.service';
import {AzureBackofficeAiConnector,AiEvidence} from '../ocr/azure-backoffice-ai.connector';
@Injectable()
export class ReportAiService {
 private active=new Set<string>();private recent=new Map<string,number[]>();
 constructor(private connector:AzureBackofficeAiConnector,private audit:AuditService,private budget:BotEnergyBudgetService,private licenses:BotEnergyLicenseService){}
 async interpret(t:TenantContext,question:string,evidence:AiEvidence[],audience:'client'|'backoffice'){
  if(!t.organizationId||!t.userId||(t.scope as string)==='global'||!t.permissions?.includes(P.DOCUMENTS_REPORTS_VIEW)||!t.permissions.includes(P.INTELLIGENCE_AI_USE)||(audience==='client'?(t.role!=='consulta'||!!t.accessMode||!t.roleId):(!['operacional','gestor','admin_org'].includes(t.role)&&t.accessMode!=='platform_operation')))return {state:'NOT_AUTHORIZED',message:'Contexto de IA não autorizado.'};
  if(!this.connector.available(t.organizationId))return {state:'NOT_CONFIGURED',message:'Interpretação indisponível. Consulte os resultados e as fontes publicadas.'};
  if(!await this.licenses.available(t.organizationId))return {state:'NOT_AUTHORIZED',message:'Bot-Energy exige licença vigente e cota disponível.'};
  const key=t.organizationId+':'+t.userId,now=Date.now();
  for(const [k,v] of this.recent)if(!v.some(n=>now-n<60000))this.recent.delete(k);
  const times=(this.recent.get(key)??[]).filter(n=>now-n<60000);
  if(this.active.has(key)||times.length>=6||this.active.size>=8||this.recent.size>=1000)return {state:'FAILED',message:'Limite de consultas atingido. Tente novamente depois.'};
  this.active.add(key);this.recent.set(key,[...times,now]);
  const requestId=randomUUID(),hash=(v:unknown)=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
  const log=(state:string,extra:Record<string,unknown>={})=>this.audit.logCreate({userId:t.userId,organizationId:t.organizationId,resourceType:'bot_report_interpretation',resourceId:requestId,after:{state,audience,questionHash:hash(question),evidenceHash:hash(evidence),...extra}});
  try{
   const reservation=await this.budget.reserve(t.organizationId,t.userId,requestId,'conversation',{inputTokens:60000,outputTokens:2200},'BOT_ENERGY');
   await log('REQUESTED');
   const result=await this.connector.interpret(t.organizationId,question,evidence,audience);
   await this.budget.settle(reservation,result.usage);
   await log(result.supported?'READY':'NO_EVIDENCE',{promptVersion:result.promptVersion,citations:result.citations,answer:result.answer,model:result.model});
   return result.supported?{state:'READY',answer:result.answer,evidence:evidence.filter(e=>result.citations.includes(e.id)),message:'Interpretação com fontes publicadas; consulta não altera nem valida resultados.'}:{state:'NO_EVIDENCE',message:'Não há evidência suficiente neste período e unidade. Confira as fontes com sua equipe de gestão.'};
  }catch{try{await log('FAILED');}catch{}return {state:'FAILED',message:'Não foi possível concluir uma resposta com fontes verificadas. Nenhum resultado foi alterado.'};}
  finally{this.active.delete(key);}
 }
}
