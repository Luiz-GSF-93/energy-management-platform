import {invoiceFinancialAdjustments} from './invoice-financial-adjustments';
import {Injectable,ForbiddenException,ConflictException,BadRequestException,ServiceUnavailableException} from '@nestjs/common';
import {auditAuthorNames} from '../contracts/services/audit-author-names';
import {createHash} from 'node:crypto';
import {SupabaseService} from '../../services/supabase.service';
import {TenantContext} from '../../common/interfaces/tenant-context.interface';
import {PERMISSIONS as P} from '../../common/constants/permissions';
import {OcrTusdIntegrationService} from './ocr-tusd-integration.service';
import {ocrReviewDigest} from './ocr-review.service';
import {extractCpflPaulistaLayout} from './cpfl-paulista-layout';
import {cipCostCandidate} from './cip-cost-candidate';
function identifier(org:string,doc:string,kind:string){const h=createHash('sha256').update(JSON.stringify(['ocr-cip-v1',org,doc,kind])).digest('hex');return h.slice(0,8)+'-'+h.slice(8,12)+'-5'+h.slice(13,16)+'-8'+h.slice(17,20)+'-'+h.slice(20,32);}
@Injectable()
export class OcrCipIntegrationService{
 constructor(private db:SupabaseService,private tusd:OcrTusdIntegrationService){}
 private canWrite(t:TenantContext){return !!t?.userId&&!!t.organizationId&&(['gestor','admin_org'].includes(t.role)||t.accessMode==='platform_operation')&&[P.DOCUMENTS_VIEW,P.ORGANIZATION_CONTRACTS_VIEW,P.ORGANIZATION_CONTRACTS_CREATE].every(p=>t.permissions?.includes(p));}
 private fail(error:any){if(error)throw new ServiceUnavailableException('Não foi possível consultar ou integrar a CIP. Atualize a situação antes de tentar novamente.');}
 private async context(document:string,t:TenantContext){
  // Reuse the scoped, licensed CPFL/ACL source and current identity/consumption confirmations.
  const c=await this.tusd.taxIntegrationSource(document,t),month=c.preview.month,client=this.db.getClient();
  const [costs,customer]=await Promise.all([client.from('calculation_monthly_costs').select('*').eq('organization_id',t.organizationId).eq('customer_id',c.source.doc.customer_id).eq('consumer_unit_id',c.unit.id).eq('month',month).order('version',{ascending:false}).limit(1),client.from('customers').select('id,status,deleted_at').eq('organization_id',t.organizationId).eq('id',c.source.doc.customer_id).maybeSingle()]);
  this.fail(costs.error);this.fail(customer.error);if(!Array.isArray(costs.data)||!customer.data)this.fail(true);
  const layout=extractCpflPaulistaLayout(c.source.raw),elektro=layout.layoutId==='neoenergia-elektro-verde',financial=invoiceFinancialAdjustments(layout),candidate=cipCostCandidate(layout.operations,month),id=identifier(t.organizationId,document,'input'),itemId=identifier(t.organizationId,document,'item');
  const reference=(elektro?'OCR Elektro · ajustes da distribuidora · documento ':'OCR CPFL · CIP · documento ')+document+' · SHA-256 '+c.source.doc.file_hash;
  const current=costs.data[0]??null,created=current?.id===id&&current.origin===(elektro?'OCR_DISTRIBUTOR':'OCR_CIP')&&current.source_reference===reference;
  const ready=c.sourceReady&&customer.data.status==='ACTIVE'&&!customer.data.deleted_at&&(elektro?financial.state==='RECONCILED'&&financial.items.length>0:candidate.ready);
  const state=created?'CREATED':current?'EXISTING_RECORD':ready?'READY':'REVIEW_REQUIRED';
  const token=ocrReviewDigest({source:c.preview.token,document,month,candidate,customer:customer.data,current});
  return {c,id,itemId,reference,current,ready,elektro,preview:{token,month,state,mode:elektro?'DISTRIBUTOR_ADJUSTMENTS':'CIP',invoiceAdjustments:financial,candidate,canCreate:state==='READY'&&this.canWrite(t),existing:current?{id:current.id,status:current.status,version:current.version,revision:current.revision}:null,message:elektro?(state==='CREATED'?'Ajustes e créditos Elektro registrados em rascunho.':state==='EXISTING_RECORD'?'Custos existentes preservados; use a revisão auditada para acrescentar ajustes.':ready?'Ajustes e créditos conciliados disponíveis para o primeiro rascunho. Tarifas não serão duplicadas nos custos.':'Conclua identidade e consumos antes de integrar os ajustes da distribuidora.'):state==='CREATED'?'CIP registrada nos custos mensais. Consulte a versão atual e o histórico.':state==='EXISTING_RECORD'?'Já existem custos nesta unidade e competência. O lançamento existente será preservado; nenhuma duplicação ou substituição automática.':ready?'CIP pronta para criar o primeiro rascunho de custos mensais.':'Confira identidade, consumo, competência, situação do cliente e evidências da fatura antes de integrar a CIP.'}};
 }
 async preview(document:string,t:TenantContext){return (await this.context(document,t)).preview;}
 async create(document:string,t:TenantContext,body:any){
  if(!this.canWrite(t))throw new ForbiddenException('A integração exige Gestor ou Administrador com permissão para cadastrar contratos.');
  if(!body||Array.isArray(body)||Object.keys(body).length!==1||typeof body.token!=='string'||!/^[a-f0-9]{64}$/.test(body.token))throw new BadRequestException('Atualize a prévia antes de integrar.');
  const x=await this.context(document,t);if(x.preview.state==='CREATED')return {inputId:x.id,alreadyCreated:true};
  if(body.token!==x.preview.token)throw new ConflictException('A prévia mudou. Atualize antes de integrar a CIP.');
  if(!x.preview.canCreate)throw new ConflictException(x.preview.message);
  const {c}=x,v=x.preview.candidate;
  const row={id:x.id,organization_id:t.organizationId,customer_id:c.source.doc.customer_id,consumer_unit_id:c.unit.id,month:x.preview.month,origin:x.elektro?'OCR_DISTRIBUTOR':'OCR_CIP',status:'DRAFT',previous_id:null,costs:{noCosts:false,items:x.elektro?x.preview.invoiceAdjustments.items.map(i=>({id:identifier(t.organizationId,document,'adjustment:'+i.source),label:i.label,category:'DISTRIBUTOR_ADJUSTMENT',scenario:'ACL',effect:i.effect,amount:i.amount,source:'OCR Elektro · ajuste · documento '+document+' · SHA-256 '+c.source.doc.file_hash+' · '+i.source,taxTreatment:'INCLUDED'})):[{id:x.itemId,label:'Contribuição de iluminação pública — CIP',category:'CHARGE',scenario:'ACL',effect:'COST',amount:v.amount,source:x.reference+' · '+v.source,taxTreatment:'INCLUDED'}]},source_reference:x.reference,notes:x.elektro?'Ajustes e créditos Elektro conciliados com o total da fatura '+x.preview.invoiceAdjustments.total+'. Tarifas TUSD, demanda e reativo pertencem aos parâmetros e não foram duplicadas. Valores finais, sem nova incidência. Job OCR '+c.source.jobId+'. Prévia '+x.preview.token+'. Conferências '+JSON.stringify(c.reviews):'Importação parcial: somente CIP. Confira os demais custos e créditos antes da validação. Não inclui TE ACL, descontos informativos, subtotais, devoluções ou subvenção. CIP registrada pelo valor final cobrado na operação; sem acréscimo de tributos. Não declara alíquotas nem isenção. Prévia '+x.preview.token+'. Job OCR '+c.source.jobId+'.',correction_reason:'',unit_context:Object.fromEntries(['distributor','tariff_group','tariff_subgroup','tariff_modality','state','free_market'].map(k=>[k,c.unit[k]??null])),created_by:t.userId,updated_by:t.userId};
  // Existing database advisory lock/one-draft trigger and deterministic ID prevent concurrent duplicates.
  const r=await this.db.getClient().from('calculation_monthly_costs').insert(row).select('id');
  if(['23505','P3602'].includes(r.error?.code)){const next=await this.context(document,t);if(next.preview.state==='CREATED')return {inputId:x.id,alreadyCreated:true};throw new ConflictException('Os custos mudaram. Atualize; nenhum lançamento existente será substituído.');}
  this.fail(r.error);if(r.data?.length!==1||r.data[0].id!==x.id)this.fail(true);return {inputId:x.id,alreadyCreated:false};
 }

 async prepareReview(document:string,t:TenantContext,body:any){
  if(!t?.userId||!t.organizationId||!(['gestor','admin_org'].includes(t.role)||t.accessMode==='platform_operation')||![P.DOCUMENTS_VIEW,P.ORGANIZATION_CONTRACTS_VIEW,P.ORGANIZATION_CONTRACTS_UPDATE].every(p=>t.permissions?.includes(p)))throw new ForbiddenException('A revisão exige Gestor ou Administrador com permissão para editar contratos.');
  if(!body||Array.isArray(body)||Object.keys(body).length!==3||typeof body.token!=='string'||!/^[a-f0-9]{64}$/.test(body.token)||typeof body.inputId!=='string'||!Number.isInteger(body.revision)||body.revision<1)throw new BadRequestException('Atualize os custos antes de revisar.');
  const x=await this.context(document,t),old=x.current;
  if(!old||old.id!==body.inputId||old.id!==x.id||old.origin!=='OCR_CIP'||old.source_reference!==x.reference||old.status!=='DRAFT'||old.revision!==body.revision||body.token!==x.preview.token)throw new ConflictException('Os custos ou a fonte mudaram. Atualize a consulta antes de revisar.');
  if(!x.ready)throw new ConflictException('A evidência OCR precisa estar conferida e conciliada antes do ajuste automático da CIP.');
  const expected=Object.fromEntries(['distributor','tariff_group','tariff_subgroup','tariff_modality','state','free_market'].map(k=>[k,x.c.unit[k]??null]));
  if(Object.entries(expected).some(([k,v])=>old.unit_context?.[k]!==v))throw new ConflictException('O cadastro da unidade mudou. Confira o contexto dos custos.');
  const items=old.costs?.items,matched=Array.isArray(items)?items.filter((i:any)=>i.id===x.itemId):[];
  const item=matched[0];
  if(old.costs?.noCosts!==false||matched.length!==1||item.label!=='Contribuição de iluminação pública — CIP'||item.category!=='CHARGE'||item.scenario!=='ACL'||item.effect!=='COST'||item.amount!==x.preview.candidate.amount||item.source!==x.reference+' · '+x.preview.candidate.source)throw new ConflictException('O lançamento CIP foi alterado ou diverge da fatura. Confira a diferença; os valores foram preservados.');
  // INCLUDED denotes the final billed amount. It does not infer rates or exemptions from blank tax cells.
  if(item.taxTreatment!=='UNSPECIFIED')return {row:(await auditAuthorNames(this.db.getClient(),t.organizationId,[old]))[0],adjusted:false};
  const reason='Ajuste automático OCR CIP: valor final da operação, sem nova incidência de tributos. Documento '+document+'; job '+x.c.source.jobId+'.';
  const correction=[old.correction_reason,reason].filter(Boolean).join('\n');
  if(correction.length>2000)throw new ConflictException('Histórico de justificativas extenso. Revise o rascunho antes de continuar.');
  const costs={...old.costs,items:items.map((i:any)=>i.id===x.itemId?{...i,taxTreatment:'INCLUDED'}:i)};
  const r=await this.db.getClient().from('calculation_monthly_costs').update({costs,correction_reason:correction,updated_by:t.userId}).eq('organization_id',t.organizationId).eq('id',old.id).eq('revision',body.revision).eq('status','DRAFT').select('*').maybeSingle();
  this.fail(r.error);if(!r.data)throw new ConflictException('Os custos mudaram durante a revisão. Atualize a consulta.');
  return {row:(await auditAuthorNames(this.db.getClient(),t.organizationId,[r.data]))[0],adjusted:true};
 }

 async integrateAdjustments(document:string,t:TenantContext,body:any){
  if(!this.canWrite(t)||!t.permissions?.includes(P.ORGANIZATION_CONTRACTS_UPDATE))throw new ForbiddenException('A revisão exige permissão para cadastrar e editar custos.');
  if(!body||Array.isArray(body)||Object.keys(body).sort().join(',')!=='inputId,reason,revision,token'||typeof body.reason!=='string'||body.reason.trim().length<20||body.reason.length>1000||typeof body.token!=='string'||typeof body.inputId!=='string'||!Number.isInteger(body.revision))throw new BadRequestException('Informe a versão atual e a justificativa da revisão.');
  const x=await this.context(document,t),old=x.current,candidate=x.preview.invoiceAdjustments;
  if(!x.ready||candidate.state!=='RECONCILED'||!old||old.id!==body.inputId||old.revision!==body.revision||body.token!==x.preview.token||!['DRAFT','VALIDATED'].includes(old.status))throw new ConflictException('Custos ou evidências mudaram. Atualize a consulta e confira o total da fatura.');
  const expectedContext=Object.fromEntries(['distributor','tariff_group','tariff_subgroup','tariff_modality','state','free_market'].map(k=>[k,x.c.unit[k]??null]));
  if(Object.entries(expectedContext).some(([k,v])=>old.unit_context?.[k]!==v)||old.costs?.noCosts!==false||!Array.isArray(old.costs.items))throw new ConflictException('Revise o contexto da unidade e a composição dos custos.');
  const items=old.costs.items.map((i:any)=>({...i}));
  const cip=items.filter((i:any)=>i.id===x.itemId);
  if(!x.elektro&&(cip.length!==1||cip[0].amount!==candidate.cip||cip[0].category!=='CHARGE'||cip[0].effect!=='COST'||cip[0].scenario!=='ACL'||cip[0].taxTreatment!=='INCLUDED'||cip[0].source!==x.reference+' · '+candidate.cipSource))throw new ConflictException('A CIP atual precisa corresponder à operação documentada, sem duplicação.');
  const proposed=candidate.items.map(i=>({id:identifier(t.organizationId,document,'adjustment:'+i.source),label:i.label,category:'DISTRIBUTOR_ADJUSTMENT',scenario:'ACL',effect:i.effect,amount:i.amount,source:(x.elektro?'OCR Elektro · ajuste · documento ':'OCR CPFL · ajuste · documento ')+document+' · SHA-256 '+x.c.source.doc.file_hash+' · '+i.source,taxTreatment:'INCLUDED'}));
  if(items.some((i:any)=>i.category==='DISTRIBUTOR_ADJUSTMENT'&&!proposed.some(p=>p.id===i.id)))throw new ConflictException('Há ajustes da distribuidora de outra origem. Concilie antes de integrar.');
  let added=0;
  for(const p of proposed){const existing=items.filter((i:any)=>i.id===p.id);if(existing.length>1||existing.length===1&&Object.entries(p).some(([k,v])=>existing[0][k]!==v))throw new ConflictException('Um ajuste existente difere da operação OCR. Preserve a divergência e revise a fonte.');if(!existing.length){items.push(p);added++;}}
  if(!added)return {inputId:old.id,alreadyCreated:true};
  const changes={costs:{noCosts:false,items},correction_reason:body.reason.trim(),updated_by:t.userId};
  const client=this.db.getClient();let result;
  if(old.status==='DRAFT')result=await client.from('calculation_monthly_costs').update(changes).eq('organization_id',t.organizationId).eq('id',old.id).eq('revision',old.revision).eq('status','DRAFT').select('id');
  else result=await client.from('calculation_monthly_costs').insert({...changes,organization_id:t.organizationId,customer_id:old.customer_id,consumer_unit_id:old.consumer_unit_id,month:old.month,previous_id:old.id,status:'DRAFT',origin:'MANUAL',source_reference:old.source_reference,notes:'Revisão dos ajustes da fatura CPFL, total '+candidate.total+'. Valores anteriores preservados na versão '+old.version+'. Job OCR '+x.c.source.jobId+'.',unit_context:expectedContext,created_by:t.userId}).select('id');
  if(['23505','P3602'].includes(result.error?.code))throw new ConflictException('Outra revisão foi criada. Atualize; nenhum custo validado foi substituído.');
  this.fail(result.error);if(result.data?.length!==1)throw new ConflictException('Os custos mudaram. Atualize o histórico.');
  return {inputId:result.data[0].id,alreadyCreated:false};
 }
}
