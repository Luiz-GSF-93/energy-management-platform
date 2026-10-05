import {Injectable,ForbiddenException,ServiceUnavailableException,Optional} from '@nestjs/common';
import {FinancialSettlementsService} from '../contracts/services/financial-settlements.service';
import {AiEvidence} from './azure-backoffice-ai.connector';
import {SupabaseService} from '../../services/supabase.service';
import {TenantContext} from '../../common/interfaces/tenant-context.interface';
import {PERMISSIONS as P} from '../../common/constants/permissions';

type Customer={id:string;company_name:string};
type Unit={id:string;customer_id:string;name:string};
type Document={id:string;customer_id:string;consumer_unit_id:string;original_filename:string;reference_month:string;ocr_status:string};
const normalize=(s:string)=>s.toLocaleLowerCase('pt-BR').normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/g,' ').trim();
export function resolveBotCustomer(question:string,customers:{id:string;company_name:string}[]){
 const words=new Set(normalize(question).split(' '));
 const ignored=new Set(['ltda','sa','s','a','company','industria','comercio','de','da','do','e','energia']);
 const matches=customers.filter(c=>normalize(c.company_name).split(' ').filter(w=>w.length>3&&!ignored.has(w)).some(w=>words.has(w)));
 return matches.length===1?matches[0].id:null;
}
@Injectable()
export class BotEnergyContextService {
 constructor(private db:SupabaseService,@Optional() private financial?:FinancialSettlementsService){}
 async portfolio(t:TenantContext,question:string):Promise<AiEvidence[]>{
  if(!this.financial||!t.permissions.includes(P.ORGANIZATION_CUSTOMERS_VIEW)||!t.permissions.includes(P.ORGANIZATION_CONSUMER_UNITS_VIEW))return [];
  const current=new Date().toISOString().slice(0,7),month=question.match(/\b20\d{2}-(0[1-9]|1[0-2])\b/)?.[0];
  const summary=await this.financial.published({from:month??current.slice(0,4)+'-01',to:month??current},t);
  if(summary.rows.length>40)throw new ServiceUnavailableException('Selecione um cliente ou uma competência para consultar todas as fontes sem truncar resultados.');
  const source='Resumo financeiro publicado · '+summary.period.from+' a '+summary.period.to;
  const result:AiEvidence[]=[{id:'portfolio-coverage',label:'Cobertura da consulta financeira',value:summary.disclosure+' Consulta: '+summary.period.from+' a '+summary.period.to+'. Publicações: '+summary.publicationCount+'. Economia calculada não comprova desperdício; os totais não representam tarifa unitária paga.',source}];
  const labels:Record<string,string>={acr:'Custo ACR',aclAfterFees:'Custo ACL após honorários',savingsAfterFees:'Economia após honorários',totalFees:'Honorários'};
  for(const row of summary.rows)result.push({id:'publication-'+row.id,label:row.customerName+' · '+row.month,value:Object.entries(labels).map(([k,label])=>label+': R$ '+(row.amounts as any)[k]).join(' · '),source:'Publicação '+row.id+' · versão '+row.version+' · hash '+row.payloadHash+' · '+row.publishedAt});
  return result;
 }
 async list(t:TenantContext){
  if(!t.organizationId||!t.userId||(t.scope as string)==='global'||![P.DOCUMENTS_VIEW,P.ORGANIZATION_CONTRACTS_VIEW,P.ORGANIZATION_CUSTOMERS_VIEW,P.ORGANIZATION_CONSUMER_UNITS_VIEW].every(p=>t.permissions.includes(p))||(!['operacional','gestor','admin_org'].includes(t.role)&&t.accessMode!=='platform_operation'))throw new ForbiddenException('Consulta por cliente exige acesso aos clientes, unidades, documentos e contratos da organização ativa.');
  const db=this.db.getClient();
  const [c,u,d]=await Promise.all([
   db.from('customers').select('id,company_name').eq('organization_id',t.organizationId).is('deleted_at',null).order('id').limit(1001),
   db.from('consumer_units').select('id,customer_id,name').eq('organization_id',t.organizationId).order('id').limit(1001),
   db.from('documents_with_intake').select('id,customer_id,consumer_unit_id,original_filename,reference_month,ocr_status,file_verified').eq('organization_id',t.organizationId).eq('document_type','INVOICE_DISTRIBUTOR').eq('file_verified',true).order('reference_month',{ascending:false}).order('created_at',{ascending:false}).limit(1001)
  ]);
  if([c,u,d].some(r=>r.error||!Array.isArray(r.data)||r.data.length>=1000))throw new ServiceUnavailableException('Não foi possível consultar o contexto completo. Abra a fatura pela Auditoria OCR.');
  const customers=c.data as Customer[],units=u.data as Unit[],documents=d.data as Document[];
  return {customers,units,documents:documents.filter(x=>units.some(v=>v.id===x.consumer_unit_id&&v.customer_id===x.customer_id)&&customers.some(v=>v.id===x.customer_id))};
 }
 async select(t:TenantContext,question:string){
  const context=await this.list(t),customerId=resolveBotCustomer(question,context.customers);
  if(!customerId)return {document:null,context};
  const docs=context.documents.filter(d=>d.customer_id===customerId);
  const units=new Set(docs.map(d=>d.consumer_unit_id));
  // Never choose a unit or month silently when the question is ambiguous.
  const month=question.match(/\b(20\d{2})-(0[1-9]|1[0-2])\b/)?.[0];
  const eligible=month?docs.filter(d=>String(d.reference_month).slice(0,7)===month):docs;
  const latest=eligible[0];
  const same=latest?eligible.filter(d=>d.consumer_unit_id===latest.consumer_unit_id&&String(d.reference_month).slice(0,7)===String(latest.reference_month).slice(0,7)):[];
  return {document:units.size===1&&same.length===1?latest:null,context,customerId};
 }
}
