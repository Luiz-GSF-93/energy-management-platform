import {BadRequestException,ConflictException,ForbiddenException,Injectable,InternalServerErrorException,NotFoundException} from '@nestjs/common';
import {SupabaseService} from '../../services/supabase.service';
import {TenantContext} from '../../common/interfaces/tenant-context.interface';
import {PERMISSIONS as P} from '../../common/constants/permissions';
import {reportHash} from './report.projection';
import {feeCents,feeMoney} from '../contracts/services/management-fee';
import type {InvestmentItem} from './investment-return';
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,month=/^(20|21)\d{2}-(0[1-9]|1[0-2])$/;
@Injectable()
export class InvestmentsService {
 constructor(private db:SupabaseService){}
 private fail(e:any){if(!e)return;if(e.code==='42501')throw new ForbiddenException('Permissão para investimentos indisponível.');if(e.code==='P3862')throw new NotFoundException('Unidade indisponível.');if(['40001','23505'].includes(e.code))throw new ConflictException('Versão alterada; atualize antes de salvar.');if(['22023','23514','22P02'].includes(e.code))throw new BadRequestException('Confira investimentos, evidências e justificativa.');throw new InternalServerErrorException('Investimentos indisponíveis.');}
 private async rpc(name:string,p:any){const r=await this.db.getClient().rpc(name,p);this.fail(r.error);return r.data;}
 async workspace(t:TenantContext,customer:string,unit:string){if(!uuid.test(customer??'')||!uuid.test(unit??''))throw new BadRequestException('Selecione empresa e unidade.');const data=await this.rpc('read_unit_investments',{p_org:t.organizationId,p_actor:t.userId,p_customer:customer,p_unit:unit});if(!t.permissions.includes(P.DOCUMENTS_VIEW))data.documents=[];data.canValidate=t.permissions.includes(P.DOCUMENTS_REPORTS_CREATE)&&t.permissions.includes(P.ORGANIZATION_CONTRACTS_CREATE)&&t.permissions.includes(P.ORGANIZATION_CONTRACTS_UPDATE)&&(t.accessMode==='platform_operation'||['admin_org','gestor'].includes(t.role));return data;}
 async save(t:TenantContext,d:any){
  if(!t.permissions.includes(P.ORGANIZATION_CONTRACTS_CREATE))throw new ForbiddenException('Cadastro de investimentos exige permissão de contratos.');
  if(!d||Object.keys(d).some(k=>!['customerId','unitId','requestId','expectedVersion','startMonth','items','sourceStudyId','note'].includes(k))||!uuid.test(d.customerId??'')||!uuid.test(d.unitId??'')||!uuid.test(d.requestId??'')||!Number.isInteger(d.expectedVersion)||d.expectedVersion<0||!month.test(d.startMonth??'')||!Array.isArray(d.items)||d.items.length<1||d.items.length>30||typeof d.note!=='string'||d.note.trim().length<20||d.note.length>1000)throw new BadRequestException('Revise os investimentos e a justificativa.');
  const workspace=await this.workspace(t,d.customerId,d.unitId);
  const items:InvestmentItem[]=d.items.map((i:any)=>{if(!i||Object.keys(i).some(k=>!['category','description','amount','date','classification','source','documentId'].includes(k))||!['MIGRATION','CCEE','ADAPTATION','OTHER'].includes(i.category)||typeof i.description!=='string'||i.description.trim().length<3||i.description.length>160||typeof i.amount!=='string'||typeof i.source!=='string'||i.source.trim().length<20||i.source.length>500||!['ESTIMATED','REALIZED'].includes(i.classification)||typeof i.date!=='string'||!/^20\d{2}-\d{2}-\d{2}$/.test(i.date)||!Number.isFinite(Date.parse(i.date+'T00:00:00Z'))||new Date(i.date+'T00:00:00Z').toISOString().slice(0,10)!==i.date)throw new BadRequestException('Confira categoria, valor, data e fonte de cada investimento.');try{feeCents(i.amount);}catch{throw new BadRequestException('Valor monetário inválido.');}
   if(i.classification==='REALIZED'&&(!uuid.test(i.documentId??'')||!workspace.documents.some((v:any)=>v.id===i.documentId)))throw new BadRequestException('Investimento realizado exige documento conferido da mesma unidade.');
   return {...i,description:i.description.trim(),source:i.source.trim()};});
  if(new Set(items.map(i=>[i.category,i.description,i.amount,i.date,i.documentId??''].join('|'))).size!==items.length)throw new BadRequestException('Há investimentos duplicados.');
  const total=feeMoney(items.reduce((n,i)=>n+feeCents(i.amount),0n));try{feeCents(total);}catch{throw new BadRequestException('Total de investimentos excede o limite monetário.');}
  let sourceStudy=null;
  if(d.sourceStudyId){if(!uuid.test(d.sourceStudyId))throw new BadRequestException('Estudo inválido.');const study=workspace.studies.find((s:any)=>s.id===d.sourceStudyId);if(!study)throw new NotFoundException('Estudo indisponível nesta unidade.');sourceStudy={id:study.id,version:study.version,payloadHash:study.payload_hash,estimatedAmount:study.amount};}
  const body={schemaVersion:'unit-investments/1',organizationId:t.organizationId,customerId:d.customerId,unitId:d.unitId,startMonth:d.startMonth,items,total,sourceStudy,note:d.note.trim()};
  return this.rpc('record_unit_investments',{p_org:t.organizationId,p_actor:t.userId,p_customer:d.customerId,p_unit:d.unitId,p_request:d.requestId,p_expected:d.expectedVersion,p_body:body,p_hash:reportHash(body)});
 }
 async validate(t:TenantContext,id:string,d:any){if(!d||Object.keys(d).sort().join(',')!=='note,payloadHash,requestId'||!uuid.test(d.requestId??'')||typeof d.note!=='string'||d.note.trim().length<20||d.note.length>1000||!/^([a-f0-9]{64})$/.test(d.payloadHash??''))throw new BadRequestException('Confira versão e justificativa.');return this.rpc('validate_unit_investments',{p_org:t.organizationId,p_actor:t.userId,p_id:id,p_request:d.requestId,p_hash:d.payloadHash,p_note:d.note.trim()});}
 async validated(t:TenantContext,customer:string,unit:string){const data=await this.workspace(t,customer,unit);const latest=data.versions?.[0];if(!latest?.validated)return null;if(latest.payload_hash!==reportHash(latest.body))throw new InternalServerErrorException('Integridade dos investimentos indisponível.');return latest;}
}
