import {BadRequestException,ConflictException,ForbiddenException,Injectable,InternalServerErrorException,NotFoundException} from '@nestjs/common';


import {SupabaseService} from '../../services/supabase.service';


import {LicensesService} from '../licenses/services/licenses.service';


import {TenantContext} from '../../common/interfaces/tenant-context.interface';


import {object,text,uuid,validateTrading} from './trading-validation';


import {compareTrading} from './trading-comparison';


export const TRADING_VIEW='60f9690a-145b-4dba-b23f-9f945baca296',TRADING_MANAGE='beb6ec90-8ba8-40ce-a156-aeef6cc75cce';


@Injectable()


export class TradingHubService {


 constructor(private db:SupabaseService,private licenses:LicensesService){}


 private client(){return this.db.getClient();}


 private fail(e:any){if(!e)return;if(e.code==='42501')throw new ForbiddenException('Trading Hub exige licença e permissão na organização.');if(e.code==='P3151'||e.code==='23505')throw new ConflictException('Registro alterado ou duplicado. Atualize antes de salvar.');if(['22023','23514'].includes(e.code))throw new BadRequestException('Revise os campos e o estado do registro.');throw new InternalServerErrorException('Não foi possível concluir a operação Trading.');}


 async allowed(t:TenantContext,write=false){if(!t?.organizationId||!t.userId||(!['admin_org','gestor','operacional'].includes(t.role)&&t.accessMode!=='platform_operation')||!t.permissions?.includes(write?TRADING_MANAGE:TRADING_VIEW))throw new ForbiddenException('Acesso exclusivo ao backoffice autorizado.');await this.licenses.requireEntitlement(t.organizationId,'trading_hub');}


 async list(t:TenantContext){await this.allowed(t);const r=await this.client().from('trading_records').select('*').eq('organization_id',t.organizationId).order('created_at',{ascending:false}).limit(1001);this.fail(r.error);if(!r.data||r.data.length>1000)throw new BadRequestException('Consulta extensa; solicite exportação por período.');return {rows:r.data,canManage:t.permissions.includes(TRADING_MANAGE),canApprove:['admin_org','gestor'].includes(t.role)||t.accessMode==='platform_operation',comparisons:r.data.filter((v:any)=>v.kind==='opportunity').map((o:any)=>({opportunityId:o.id,rows:compareTrading(o,r.data.filter((p:any)=>p.kind==='proposal'&&p.parent_id===o.id))}))};}


 async documents(t:TenantContext){await this.allowed(t);const r=await this.client().from('documents').select('id,original_filename,customer_id,consumer_unit_id').eq('organization_id',t.organizationId).eq('file_verified',true).order('created_at',{ascending:false}).limit(1001);this.fail(r.error);if(r.data.length>1000)throw new BadRequestException('Muitos documentos; solicite a consulta por unidade.');return r.data;}
 async one(id:string,t:TenantContext){uuid(id);const r=await this.client().from('trading_records').select('*').eq('organization_id',t.organizationId).eq('id',id).maybeSingle();this.fail(r.error);if(!r.data)throw new NotFoundException('Registro indisponível na organização.');return r.data;}


 async history(id:string,t:TenantContext){await this.allowed(t);await this.one(id,t);const r=await this.client().from('trading_history').select('*').eq('organization_id',t.organizationId).eq('record_id',id).order('revision',{ascending:false});this.fail(r.error);return r.data;}


 async save(kind:string,id:string|null,input:unknown,t:TenantContext){await this.allowed(t,true);if(id)uuid(id);const b=object(input);if(Object.keys(b).some(k=>!['revision','parentId','data','reason'].includes(k))||!Number.isInteger(b.revision)||b.revision<(id?1:0))throw new BadRequestException('Revisão ou campos inválidos.');const d=validateTrading(kind,b.data);const parent=kind==='proposal'?uuid(b.parentId):null;const opportunity=parent?await this.one(parent,t):null;if(opportunity&&(opportunity.kind!=='opportunity'||!['DRAFT','OPEN','ANALYSIS'].includes(opportunity.status)||opportunity.data.energyType!==d.energyType))throw new BadRequestException('Proposta fora da cotação ou modalidade.');


  if(kind==='proposal'){const s=await this.one(d.supplierId,t);if(s.kind!=='supplier'||s.status!=='ACTIVE')throw new BadRequestException('Selecione fornecedor ativo desta organização.');}


  if(kind==='opportunity'){const u=await this.client().from('consumer_units').select('id').eq('organization_id',t.organizationId).eq('customer_id',d.customerId).eq('id',d.unitId).maybeSingle();this.fail(u.error);if(!u.data)throw new ForbiddenException('Unidade fora do escopo.');}


  for(const doc of d.documents??[]){const r=await this.client().from('documents').select('id,file_verified,customer_id,consumer_unit_id').eq('organization_id',t.organizationId).eq('id',doc).maybeSingle();this.fail(r.error);if(!r.data?.file_verified)throw new BadRequestException('Anexo deve ser documento verificado desta organização.');if((kind==='opportunity'||opportunity)&&(r.data.customer_id!==(opportunity?.data.customerId??d.customerId)||r.data.consumer_unit_id!==(opportunity?.data.unitId??d.unitId)))throw new BadRequestException('Anexo fora do cliente e unidade.');}


  const r=await this.client().rpc('save_trading_record',{p_org:t.organizationId,p_actor:t.userId,p_kind:kind,p_id:id,p_revision:b.revision,p_parent:parent,p_data:d,p_reason:text(b.reason,3,500)});this.fail(r.error);return r.data;


 }


 async contract(id:string,input:unknown,t:TenantContext){await this.allowed(t,true);const b=object(input);uuid(id);if(!Number.isInteger(b.revision)||Object.keys(b).some(k=>!['revision','documentId','reference','reason'].includes(k)))throw new BadRequestException('Campos ou revisão inválidos.');const r=await this.client().rpc('contract_trading_proposal',{p_org:t.organizationId,p_actor:t.userId,p_id:id,p_revision:b.revision,p_document:text(b.documentId,1,200),p_reference:text(b.reference,3,200),p_reason:text(b.reason,3,500)});this.fail(r.error);return r.data;}
 async transition(id:string,input:unknown,t:TenantContext){await this.allowed(t,true);uuid(id);const b=object(input);if(Object.keys(b).some(k=>!['status','revision','reason'].includes(k))||!Number.isInteger(b.revision)||b.revision<1)throw new BadRequestException('Revisão inválida.');if(b.status==='MANAGER_APPROVED'&&!(['admin_org','gestor'].includes(t.role)||t.accessMode==='platform_operation'))throw new ForbiddenException('Aprovação exige gestor ou administrador.');const r=await this.client().rpc('transition_trading_record',{p_org:t.organizationId,p_actor:t.userId,p_id:id,p_revision:b.revision,p_status:text(b.status,1,30),p_reason:text(b.reason,3,500)});this.fail(r.error);return r.data;}


}


