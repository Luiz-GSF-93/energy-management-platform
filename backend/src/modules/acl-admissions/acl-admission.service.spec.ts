import { randomUUID } from 'crypto';
import { AclAdmissionService, aclCursor, ACL_MANAGE, ACL_VIEW } from './acl-admission.service';
import { TenantContext } from '../../common/interfaces/tenant-context.interface';
const customerView='cbb2e904-0718-4eec-9396-dba899118cdd', reportView='3ebadd32-6f30-459e-8ed3-0d2843d89946';
const tenant: TenantContext={organizationId:'o1',userId:randomUUID(),roleId:randomUUID(),role:'gestor',permissions:[ACL_VIEW,ACL_MANAGE,customerView],email:'consultor@example.test',scope:'organization'};
function harness(enabled=true) {
 const rpc=jest.fn(async(name:string,p:any):Promise<any>=>{
  if(name==='acl_assert_actor')return{data:{organizationId:p.p_org,actorId:p.p_actor,canWork:true,canApprove:true}};
  if(name==='acl_create')return{data:{organizationId:p.p_org,customerId:p.p_customer,unitId:p.p_unit,id:randomUUID()}};
  return{data:[]};
 });
 const licenses={requireEntitlement:jest.fn().mockResolvedValue({})};
 const service=new AclAdmissionService({getClient:()=>({rpc})} as any,licenses as any,{get:()=>enabled?'o1':''} as any);
 return{rpc,licenses,service};
}
describe('ACL registry API authorization and projection',()=>{
 it('previews supplier terms only against a currently authorized and approved server history',async()=>{
  const h=harness(),id=randomUUID(),evidenceId=randomUUID(),t={...tenant,permissions:[...tenant.permissions,'8f105b02-4443-49de-b188-847e0284e7ed']};
  const history={sourceDocumentId:'invoice',rows:Array.from({length:12},(_,i)=>({month:new Date(Date.UTC(2025,8+i,1)).toISOString().slice(0,7),peakKwh:'10',offPeakKwh:'100',demandKw:'200',days:30,page:2,source:'table'}))};
  const body={evidenceId,proposal:{supplier:'Fornecedor teste',energyBrlMwh:'220',startMonth:'2026-11',months:12,fixedMonthlyBrl:'990',savingsPercent:'9.5',estimatedMonthlyAclBrl:'350',distribution:null,losses:'PENDING',taxes:'PENDING',source:'Parâmetros informados para uma simulação interna.',checked:true}};
  jest.spyOn(h.service as any,'invoiceLocation').mockResolvedValue({uf:'SP',code:'SE_CO',reviewRequired:true});
  h.rpc.mockImplementation(async(name,p)=>({data:name==='acl_assert_actor'?{organizationId:p.p_org,actorId:p.p_actor,canWork:true,canApprove:true}:{evidenceId,history,documents:[{id:'invoice',version:1,fileHash:'a'.repeat(64)}]}}));
  await expect(h.service.supplierPreview(id,body,tenant)).rejects.toThrow('documentos');
  await expect(h.service.supplierPreview(id,body,{...t,role:'cliente'})).rejects.toThrow('backoffice');
  await expect(h.service.supplierPreview(id,body,{...t,scope:'global'} as any)).rejects.toThrow('organização');
  for(const extra of [{rows:history.rows},{organizationId:'foreign'},{evidenceId:'bad'},{savings:'1000'}])await expect(h.service.supplierPreview(id,{...body,...extra},t)).rejects.toThrow();
  const r=await h.service.supplierPreview(id,body,t);expect(r.energySubtotal).toBe('290.40');expect(r.fixedFeeSubtotal).toBe('11880.00');expect(r.savings).toBeNull();
  expect(h.rpc).toHaveBeenLastCalledWith('acl_history_simulation_source',expect.objectContaining({p_org:'o1',p_id:id,p_evidence:evidenceId,p_actor:t.userId}));
  expect(h.licenses.requireEntitlement).toHaveBeenCalledWith('o1','document_management');
  h.rpc.mockResolvedValue({error:{code:'42501'}});await expect(h.service.supplierPreview(id,body,t)).rejects.toThrow('vínculo');
  h.rpc.mockImplementation(async(name,p)=>({data:name==='acl_assert_actor'?{organizationId:p.p_org,actorId:p.p_actor,canWork:true,canApprove:true}:{evidenceId:randomUUID(),history}}));await expect(h.service.supplierPreview(id,body,t)).rejects.toThrow('Fonte');
 });
 it('reads invoice address only under admission tenant/customer/unit and current approved/OCR hashes',async()=>{
  const h=harness(),id=randomUUID(),queries:any[]=[];let hash='changed';
  const data:any={documents:{id:'invoice',file_verified:true,document_type:'INVOICE_DISTRIBUTOR',file_hash:'original'},document_ocr_jobs:{id:'job',state:'SUCCEEDED'}};
  const from=jest.fn(table=>{const q:any={select:()=>q,eq:jest.fn(()=>q),maybeSingle:async()=>({data:table==='document_ocr_results'?{file_hash:hash,raw_result:{}}:data[table]})};queries.push(q);return q;});
  (h.service as any).db={getClient:()=>({from})};jest.spyOn(h.service,'one').mockResolvedValue({customerId:'c1',unitId:'u1'} as any);
  await expect((h.service as any).invoiceLocation(id,'invoice',[{id:'invoice',fileHash:'original'}],tenant)).rejects.toThrow('outra versão');
  for(const q of queries)expect(q.eq).toHaveBeenCalledWith('organization_id','o1');expect(queries[0].eq).toHaveBeenCalledWith('customer_id','c1');expect(queries[0].eq).toHaveBeenCalledWith('consumer_unit_id','u1');expect(queries[2].eq).toHaveBeenCalledWith('job_id','job');
  hash='original';expect(await (h.service as any).invoiceLocation(id,'invoice',[{id:'invoice',fileHash:'original'}],tenant)).toMatchObject({documentId:'invoice',code:null,status:'PENDING'});
  data.documents.file_hash='new';await expect((h.service as any).invoiceLocation(id,'invoice',[{id:'invoice',fileHash:'original'}],tenant)).rejects.toThrow('fatura mudou');
 });
 it('simulates only server-approved history under current tenant, document license and Verde A4 context',async()=>{
  const h=harness(),id=randomUUID(),evidenceId=randomUUID(),t={...tenant,permissions:[...tenant.permissions,'8f105b02-4443-49de-b188-847e0284e7ed']};
  const history={sourceDocumentId:'invoice',rows:Array.from({length:12},(_,i)=>({month:new Date(Date.UTC(2025,8+i,1)).toISOString().slice(0,7),peakKwh:'10',offPeakKwh:'100',demandKw:'200',days:30,page:2,source:'table'}))};
  const body={evidenceId,tariffs:{peakBrlKwh:'1',offPeakBrlKwh:'0.5',demandBrlKw:'10',referenceMonth:'2026-08',source:'Fatura revisada, tarifas brutas.',checked:true}};
  const unit={tariff_group:'A',tariff_subgroup:'A4',tariff_modality:'GREEN'},seen:any[]=[];
  const query:any={select:()=>query,eq:(k:string,v:unknown)=>{seen.push([k,v]);return query;},maybeSingle:async()=>({data:unit})};
  (h.service as any).db={getClient:()=>({rpc:h.rpc,from:(name:string)=>{expect(name).toBe('consumer_units');return query;}})};
  h.rpc.mockImplementation(async(name,p)=>({data:name==='acl_assert_actor'?{organizationId:p.p_org,actorId:p.p_actor,canWork:true,canApprove:true}:name==='acl_read'?[{id,organizationId:'o1',customerId:'c1',unitId:'u1'}]:{evidenceId,history,documents:[{id:'invoice',version:1,fileHash:'a'.repeat(64)}]}}));
  await expect(h.service.historySimulation(id,body,tenant)).rejects.toThrow('documentos');
  await expect(h.service.historySimulation(id,body,{...t,role:'consulta'})).rejects.toThrow('backoffice');
  for(const extra of [{rows:history.rows},{organizationId:'o2'},{evidenceId:'invalid'}])await expect(h.service.historySimulation(id,{...body,...extra},t)).rejects.toThrow();
  expect((await h.service.historySimulation(id,body,t)).annualSubtotal).toBe('24720.00');
  expect(seen).toEqual(expect.arrayContaining([['organization_id','o1'],['customer_id','c1'],['id','u1']]));
  expect(h.rpc).toHaveBeenLastCalledWith('acl_history_simulation_source',expect.objectContaining({p_org:'o1',p_id:id,p_evidence:evidenceId,p_actor:t.userId}));
  unit.tariff_modality='BLUE';await expect(h.service.historySimulation(id,body,t)).rejects.toThrow('Verde A4');
 });
 it('accepts a reviewed single-invoice history and rejects forged cost/scope fields',async()=>{
  const h=harness(),id=randomUUID(),t={...tenant,permissions:[...tenant.permissions,'8f105b02-4443-49de-b188-847e0284e7ed']};
  const rows=Array.from({length:12},(_,i)=>({month:new Date(Date.UTC(2025,8+i,1)).toISOString().slice(0,7),peakKwh:'10',offPeakKwh:'100',demandKw:'200',days:30,page:2,source:'tables[0]'}));
  const body={requestId:randomUUID(),expectedRevision:1,action:'SUBMIT',stageKey:'invoices',kind:'COMPLETE',documentIds:['invoice'],facts:{history:{sourceDocumentId:'invoice',rows}},note:'Histórico conferido pelo Consultor com fontes.',checkedDocument:true};
  h.rpc.mockImplementation(async(name,p)=>name==='acl_assert_actor'?{data:{organizationId:p.p_org,actorId:p.p_actor,canWork:true,canApprove:true}}:{data:{ok:true,evidenceId:randomUUID(),admission:{id,organizationId:'o1'}}});
  await h.service.evidenceCommand(id,body,t);expect(h.rpc).toHaveBeenLastCalledWith('acl_evidence_command',expect.objectContaining({p_documents:['invoice'],p_facts:body.facts,p_org:'o1'}));
  for(const change of [{sourceDocumentId:'other'},{rows:rows.slice(1)},{rows:rows.map((r,i)=>i? r:{...r,cost:'10'})}])await expect(h.service.evidenceCommand(id,{...body,facts:{history:{...body.facts.history,...change}}},t)).rejects.toThrow('histórico');
 });
 it('scopes OCR history reads to the admission unit and refuses mismatched source hashes',async()=>{
  const h=harness(),id=randomUUID(),queries:any[]=[];let hash='changed';
  const data:any={documents:{id:'invoice',reference_month:'2026-08-01',document_type:'INVOICE_DISTRIBUTOR',file_verified:true,file_hash:'original'},document_ocr_jobs:{id:'job',state:'SUCCEEDED'}};
  const from=jest.fn(table=>{const q:any={table,select:jest.fn(()=>q),eq:jest.fn(()=>q),maybeSingle:jest.fn(async()=>({data:table==='document_ocr_results'?{file_hash:hash,raw_result:{}}:data[table]}))};queries.push(q);return q;});
  (h.service as any).db={getClient:()=>({from})};jest.spyOn(h.service as any,'evidenceAllowed').mockResolvedValue(undefined);jest.spyOn(h.service,'one').mockResolvedValue({customerId:'c1',unitId:'u1'} as any);
  await expect(h.service.historyPreview(id,'invoice',tenant)).rejects.toThrow('fonte');
  for(const q of queries)expect(q.eq).toHaveBeenCalledWith('organization_id','o1');expect(queries[0].eq).toHaveBeenCalledWith('customer_id','c1');expect(queries[0].eq).toHaveBeenCalledWith('consumer_unit_id','u1');expect(queries[2].eq).toHaveBeenCalledWith('job_id','job');
  data.documents.reference_month='2026-08-01T00:00:00';await expect(h.service.historyPreview(id,'invoice',tenant)).rejects.toThrow('fonte');
  hash='original';await expect(h.service.historyPreview(id,'invoice',tenant)).rejects.toThrow('layout');
  data.documents=null;await expect(h.service.historyPreview(id,'invoice',tenant)).rejects.toThrow('unidade');
 });

 it('authorizes reopening and rejects body-supplied history, scope and approvals',async()=>{
  const h=harness(),id=randomUUID(),body={requestId:randomUUID(),expectedRevision:5,reason:'Correção revisada pelo Consultor responsável.',checkedDocument:true};
  for(const extra of [{generation:2},{previousId:id},{organizationId:'o2'},{checkedDocument:false},{state:{}}])await expect(h.service.reopen(id,{...body,...extra},tenant)).rejects.toThrow();
  const t={...tenant,permissions:[...tenant.permissions,'8f105b02-4443-49de-b188-847e0284e7ed']};
  await expect(h.service.reopen(id,body,{...t,role:'operacional'})).rejects.toThrow('aprovação');
  h.rpc.mockImplementation(async(name,p)=>name==='acl_assert_actor'?{data:{organizationId:p.p_org,actorId:p.p_actor,canWork:true,canApprove:true}}:{data:{ok:true,admission:{id:randomUUID(),previousId:id,organizationId:'o1'}}});
  expect((await h.service.reopen(id,body,t)).previousId).toBe(id);expect(h.rpc).toHaveBeenLastCalledWith('acl_reopen',expect.objectContaining({p_org:'o1',p_id:id,p_reason:body.reason,p_actor:t.userId}));
 });
 it('restricts performance queries to authorized context and bounds its filters',async()=>{
  const h=harness(),t={...tenant,permissions:[...tenant.permissions,'8f105b02-4443-49de-b188-847e0284e7ed']};
  for(const q of [{organizationId:'o2'},{actorId:'other'},{unitId:['u1']},{after:'bad'}])await expect(h.service.performance(q,t)).rejects.toThrow();
  await expect(h.service.performance({},tenant)).rejects.toThrow('documentos');await expect(h.service.performance({}, {...t,role:'consulta'})).rejects.toThrow('backoffice');
  await h.service.performance({unitId:'u1'},t);expect(h.rpc).toHaveBeenLastCalledWith('acl_performance_read',expect.objectContaining({p_org:'o1',p_unit:'u1',p_after:null}));
  expect(h.licenses.requireEntitlement).toHaveBeenCalledWith('o1','document_management');
 });
 it('requires approval and explicit closure review and rejects spoofed publication data',async()=>{
  const h=harness(),id=randomUUID(),body={requestId:randomUUID(),expectedRevision:5,action:'CLOSE',checkedDocument:true};
  for(const invalid of [{checkedDocument:false},{modality:'RETAIL'},{supplyDate:'2026-12-01'},{state:{status:'COMPLETED'}},{performanceHash:'a'.repeat(64)}])await expect(h.service.closureCommand(id,{...body,...invalid},tenant)).rejects.toThrow();
  await expect(h.service.closureCommand(id,body,{...tenant,role:'operacional',permissions:[...tenant.permissions,'8f105b02-4443-49de-b188-847e0284e7ed']})).rejects.toThrow('aprovação');
  expect(h.rpc.mock.calls.some(c=>c[0]==='acl_closure_command')).toBe(false);
 });
 it('binds publication to the reviewed hash, uses live scope and rejects foreign performance',async()=>{
  const h=harness(),id=randomUUID(),hash='a'.repeat(64),t={...tenant,permissions:[...tenant.permissions,'8f105b02-4443-49de-b188-847e0284e7ed']};
  const body={requestId:randomUUID(),expectedRevision:50,action:'PUBLISH',checkedDocument:true,performanceHash:hash,conclusion:'Adesão concluída e suprimento confirmado.'};
  h.rpc.mockImplementation(async(name,p)=>name==='acl_assert_actor'?{data:{organizationId:p.p_org,actorId:p.p_actor,canWork:true,canApprove:true}}:{data:{ok:true,admission:{id,organizationId:'o1'},closure:{performance:{body:{organizationId:'o1',admissionId:id}}}}});
  expect((await h.service.closureCommand(id,body,t)).admission.id).toBe(id);
  expect(h.rpc).toHaveBeenLastCalledWith('acl_closure_command',expect.objectContaining({p_org:'o1',p_actor:t.userId,p_hash:hash,p_conclusion:body.conclusion,p_revision:50,p_checked:true}));
  h.rpc.mockImplementation(async(name,p)=>name==='acl_assert_actor'?{data:{organizationId:p.p_org,actorId:p.p_actor,canWork:true,canApprove:true}}:{data:{performance:{body:{organizationId:'o2',admissionId:id}}}});
  await expect(h.service.closureRead(id,t)).rejects.toThrow('Escopo');
 });
 it('surfaces committed closure conflicts without repeating a command automatically',async()=>{
  const h=harness(),id=randomUUID(),t={...tenant,permissions:[...tenant.permissions,'8f105b02-4443-49de-b188-847e0284e7ed']};
  h.rpc.mockImplementation(async(name,p)=>name==='acl_assert_actor'?{data:{organizationId:p.p_org,actorId:p.p_actor,canWork:true,canApprove:true}}:{data:{ok:false,code:'DEPENDENCIES'}});
  await expect(h.service.closureCommand(id,{requestId:randomUUID(),expectedRevision:8,action:'CLOSE',checkedDocument:true},t)).rejects.toThrow('Conclua');
  expect(h.rpc.mock.calls.filter(c=>c[0]==='acl_closure_command')).toHaveLength(1);
 });
 it('protects evidence access with document entitlement and prevents operator approval',async()=>{
  const h=harness(),id=randomUUID();
  await expect(h.service.evidenceList(id,{},tenant)).rejects.toThrow('documentos');
  await expect(h.service.evidenceList(id,{}, {...tenant,role:'consulta'})).rejects.toThrow('backoffice');
  const operator={...tenant,role:'operacional',permissions:[...tenant.permissions,'8f105b02-4443-49de-b188-847e0284e7ed','26cadaa7-2eea-4080-91f6-1f26f87ca809']};
  expect((await h.service.access(operator)).canApprove).toBe(false);
  await expect(h.service.evidenceCommand(id,{requestId:randomUUID(),expectedRevision:1,action:'APPROVE',evidenceId:randomUUID(),note:'Conferência dos documentos e aplicabilidade.',checkedDocument:true},operator)).rejects.toThrow('aprovação');
  expect(h.rpc.mock.calls.some(c=>c[0]==='acl_evidence_command')).toBe(false);
 });
 it('rejects forged evidence snapshots, unchecked review and invalid command fields',async()=>{
  const h=harness(),id=randomUUID(),body={requestId:randomUUID(),expectedRevision:1,action:'SUBMIT',stageKey:'registration',kind:'COMPLETE',documentIds:['doc-1'],facts:{},note:'Conferência dos documentos e aplicabilidade.',checkedDocument:true};
  for(const invalid of [{fileHash:'a'.repeat(64)},{actorName:'Expert'},{checkedDocument:false},{facts:{elapsedMs:9999}},{evidenceId:randomUUID()},{documentIds:['doc-1','doc-1']}])await expect(h.service.evidenceCommand(id,{...body,...invalid},tenant)).rejects.toThrow();
  await expect(h.service.evidenceCommand(id,{...body,stageKey:'supply',facts:{supplyDate:'2026-02-30'}},tenant)).rejects.toThrow('válida');
  expect(h.rpc).not.toHaveBeenCalled();
 });
 it('uses the authenticated scope for evidence commands and rejects mismatched responses',async()=>{
  const h=harness(),id=randomUUID(),evidenceId=randomUUID(),t={...tenant,permissions:[...tenant.permissions,'8f105b02-4443-49de-b188-847e0284e7ed']};
  const body={requestId:randomUUID(),expectedRevision:3,action:'COMPLETE',evidenceId,checkedDocument:true};
  h.rpc.mockImplementation(async(name,p)=>name==='acl_assert_actor'?{data:{organizationId:p.p_org,actorId:p.p_actor,canWork:true,canApprove:true}}:{data:{ok:true,admission:{id,organizationId:'o1'},evidenceId}});
  expect((await h.service.evidenceCommand(id,body,t)).evidenceId).toBe(evidenceId);
  expect(h.licenses.requireEntitlement).toHaveBeenCalledWith('o1','document_management');
  expect(h.rpc).toHaveBeenLastCalledWith('acl_evidence_command',expect.objectContaining({p_org:'o1',p_actor:tenant.userId,p_id:id,p_evidence:evidenceId,p_facts:null,p_documents:null,p_checked:true}));
  h.rpc.mockImplementation(async(name,p)=>name==='acl_assert_actor'?{data:{organizationId:p.p_org,actorId:p.p_actor,canWork:true,canApprove:true}}:{data:{ok:true,admission:{id,organizationId:'o2'},evidenceId}});
  await expect(h.service.evidenceCommand(id,body,t)).rejects.toThrow('indisponível');
 });
 it('returns dependency conflicts without silently changing the expected revision',async()=>{
  const h=harness(),id=randomUUID(),t={...tenant,permissions:[...tenant.permissions,'8f105b02-4443-49de-b188-847e0284e7ed']};
  h.rpc.mockImplementation(async(name,p)=>name==='acl_assert_actor'?{data:{organizationId:p.p_org,actorId:p.p_actor,canWork:true,canApprove:true}}:{data:{ok:false,code:'DEPENDENCIES'}});
  await expect(h.service.evidenceCommand(id,{requestId:randomUUID(),expectedRevision:2,action:'COMPLETE',evidenceId:randomUUID(),checkedDocument:true},t)).rejects.toThrow('pré-condições');
  expect(h.rpc.mock.calls.filter(c=>c[0]==='acl_evidence_command')).toHaveLength(1);
 });
 it('rejects browser time, actor and completion fields on work commands',async()=>{
  const h=harness(),id=randomUUID(),body={requestId:randomUUID(),expectedRevision:1,stageKey:'registration',action:'START'};
  for(const extra of [{now:1},{elapsedMs:90000},{actorId:'other'},{evidenceRef:'unverified'},{organizationId:'o2'}])await expect(h.service.work(id,{...body,...extra},tenant)).rejects.toThrow();
  await expect(h.service.work(id,{...body,action:'COMPLETE'},tenant)).rejects.toThrow();
  await expect(h.service.work(id,{...body,action:'PAUSE',pauseReason:'OTHER',reason:'curto'},tenant)).rejects.toThrow();
  expect(h.rpc).not.toHaveBeenCalled();
 });
 it('passes only server context to the atomic work RPC and checks returned scope',async()=>{
  const h=harness(),id=randomUUID(),body={requestId:randomUUID(),expectedRevision:2,stageKey:'registration',action:'PAUSE',pauseReason:'AWAITING_CUSTOMER'};
  h.rpc.mockImplementation(async(name,p)=>name==='acl_assert_actor'?{data:{organizationId:p.p_org,actorId:p.p_actor,canWork:true,canApprove:false}}:{data:{ok:true,admission:{id,organizationId:'o1'}}});
  expect((await h.service.work(id,body,tenant)).id).toBe(id);
  expect(h.rpc).toHaveBeenLastCalledWith('acl_work_command',expect.objectContaining({p_org:'o1',p_actor:tenant.userId,p_id:id,p_request:body.requestId,p_revision:2,p_pause:'AWAITING_CUSTOMER',p_reason:null}));
  h.rpc.mockImplementation(async(name,p)=>name==='acl_assert_actor'?{data:{organizationId:p.p_org,actorId:p.p_actor,canWork:true,canApprove:false}}:{data:{ok:true,admission:{id,organizationId:'o2'}}});
  await expect(h.service.work(id,body,tenant)).rejects.toThrow('indisponível');
 });
 it('maps committed lease reconciliation to conflict without automatic retry',async()=>{
  const h=harness(),id=randomUUID();
  h.rpc.mockImplementation(async(name,p)=>name==='acl_assert_actor'?{data:{organizationId:p.p_org,actorId:p.p_actor,canWork:true,canApprove:false}}:{data:{ok:false,code:'CONFLICT',admission:{revision:3}}});
  await expect(h.service.work(id,{requestId:randomUUID(),expectedRevision:2,stageKey:'registration',action:'RESUME'},tenant)).rejects.toThrow('interrompida');
  expect(h.rpc.mock.calls.filter(v=>v[0]==='acl_work_command')).toHaveLength(1);
 });
 it('limits heartbeat DTOs and returns only server confirmation metadata',async()=>{
  const h=harness(),id=randomUUID();
  await expect(h.service.heartbeat(id,{stageKey:'registration',confirmedAt:'2099-01-01'},tenant)).rejects.toThrow();
  h.rpc.mockImplementation(async(name,p)=>name==='acl_assert_actor'?{data:{organizationId:p.p_org,actorId:p.p_actor,canWork:true,canApprove:false}}:{data:{ok:true,confirmedAt:'2026-10-06T20:00:00Z',revision:2,internal:'hidden'}});
  expect(await h.service.heartbeat(id,{stageKey:'registration'},tenant)).toEqual({confirmedAt:'2026-10-06T20:00:00Z',revision:2});
  await expect(h.service.heartbeat(id,{stageKey:'registration'},{...tenant,role:'consulta'})).rejects.toThrow('backoffice');
 });
 it('keeps rollout disabled by default and never calls a write RPC when disabled',async()=>{
  const h=harness(false);expect((await h.service.access(tenant)).enabled).toBe(false);
  await expect(h.service.create({requestId:randomUUID(),customerId:'c1',unitId:'u1'},tenant)).rejects.toThrow('não habilitada');
  expect(h.rpc).not.toHaveBeenCalled();
 });
 it('rejects global context, client role and insufficient permissions',async()=>{
  const h=harness();
  await expect(h.service.access({...tenant,scope:'global'} as any)).rejects.toThrow('organização');
  await expect(h.service.access({...tenant,role:'consulta'})).rejects.toThrow('backoffice');
  await expect(h.service.create({requestId:randomUUID(),customerId:'c1',unitId:'u1'},{...tenant,permissions:[ACL_VIEW,customerView]})).rejects.toThrow('backoffice');
  expect(h.rpc).not.toHaveBeenCalled();
 });
 it('rejects spoofed scope, operator capabilities, clock and workflow state from request bodies',async()=>{
  const h=harness();
  for(const extra of [{organizationId:'o2'},{actorId:'other'},{canApprove:true},{now:0},{state:{status:'COMPLETED'}}]){
   await expect(h.service.create({requestId:randomUUID(),customerId:'c1',unitId:'u1',...extra},tenant)).rejects.toThrow();
  }
  expect(h.rpc).not.toHaveBeenCalled();
 });
 it('passes server-resolved organization, actor and role to the authorized create RPC',async()=>{
  const h=harness();const requestId=randomUUID();await h.service.create({requestId,customerId:'c1',unitId:'u1'},tenant);
  expect(h.rpc).toHaveBeenCalledWith('acl_create',{p_org:'o1',p_actor:tenant.userId,p_role:tenant.roleId,p_platform:false,p_request:requestId,p_customer:'c1',p_unit:'u1'});
  expect(h.licenses.requireEntitlement).toHaveBeenCalledWith('o1','free_market_management');
 });
 it('fails closed when live database authorization is revoked or its scope differs',async()=>{
  const h=harness();h.rpc.mockResolvedValueOnce({error:{code:'42501'}});
  await expect(h.service.list({},tenant)).rejects.toThrow('vínculo');
  h.rpc.mockResolvedValueOnce({data:{organizationId:'o2',actorId:tenant.userId,canWork:true,canApprove:true}});
  await expect(h.service.list({},tenant)).rejects.toThrow('Escopo');
 });
 it('rejects unknown filters and malformed pagination tokens',()=>{
  expect(aclCursor({})).toBeNull();expect(aclCursor({after:'unit-1'},true)).toBe('unit-1');
  for(const q of [{organizationId:'o2'},{customerId:'other'},{after:['x']},{after:'x'},[],'x',null])expect(()=>aclCursor(q)).toThrow();
 });
 it('bounds pages and carries a cursor without returning the extra row',async()=>{
  const h=harness();const rows=Array.from({length:51},()=>({id:randomUUID()}));
  h.rpc.mockImplementation(async(name,p)=>name==='acl_assert_actor'?{data:{organizationId:p.p_org,actorId:p.p_actor,canWork:true,canApprove:true}}:{data:rows});
  const page=await h.service.list({},tenant);expect(page.rows).toHaveLength(50);expect(page.nextCursor).toBe(rows[49].id);
 });
 it('never forwards an internal workflow, notes, cursor or operators to the client',async()=>{
  const h=harness();const raw={cursor:randomUUID(),unitId:'u1',unitName:'Unidade',status:'CONCLUDED',stages:[{private:true}],actorId:'secret',notes:'internal',summary:{modality:'RETAIL',supplyDate:'2026-11-01',conclusion:'Adesão concluída.',publishedAt:'2026-10-06T12:00:00Z',private:'secret'}};
  h.rpc.mockResolvedValue({data:[raw]});const result=await h.service.portal({},{...tenant,role:'consulta',permissions:[reportView]});
  expect(result.rows).toEqual([{unitId:'u1',unitName:'Unidade',status:'CONCLUDED',summary:{modality:'RETAIL',supplyDate:'2026-11-01',conclusion:'Adesão concluída.',publishedAt:'2026-10-06T12:00:00Z'}}]);
  expect(JSON.stringify(result)).not.toMatch(/secret|internal|stages|actorId/);
 });
 it('withholds a final summary while a process is still in progress',async()=>{
  const h=harness();h.rpc.mockResolvedValue({data:[{cursor:randomUUID(),unitId:'u1',unitName:'Unidade',status:'IN_PROGRESS',summary:{private:true}}]});
  const result=await h.service.portal({},{...tenant,role:'consulta',permissions:[reportView]});expect(result.rows).toEqual([{unitId:'u1',unitName:'Unidade',status:'IN_PROGRESS'}]);
 });
 it('denies portal use by backoffice, platform-operation sessions or revoked external bindings',async()=>{
  const h=harness();await expect(h.service.portal({},tenant)).rejects.toThrow('externa');
  await expect(h.service.portal({},{...tenant,role:'consulta',accessMode:'platform_operation',permissions:[reportView]})).rejects.toThrow('externa');
  h.rpc.mockResolvedValue({error:{code:'42501'}});await expect(h.service.portal({},{...tenant,role:'consulta',permissions:[reportView]})).rejects.toThrow('vínculo');
 });
});
