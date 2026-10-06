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
