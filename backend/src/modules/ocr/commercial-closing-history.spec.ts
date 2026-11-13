import {commercialClosingHistory} from './commercial-closing-history';
import {EvaReadUnavailable} from '../../common/services/read-deadline';
const tenant:any={organizationId:'org',userId:'actor',roleId:'role',accessMode:'organization'};
const row=(month='2026-04',extra:any={})=>({id:'row',organization_id:'org',customer_id:'customer',month,version:7,...extra});
const read=(db:any,months=['2026-04'],t=tenant)=>commercialClosingHistory(db,t,'unit','customer',months,'DOCUMENTED');
describe('current authorized CCEE history with bounded database pressure',()=>{
 afterEach(()=>jest.useRealTimers());
 it('opens only one request at a time across six months and both scopes',async()=>{
  let release!:(v:any)=>void;const first=new Promise(r=>release=r),rpc=jest.fn().mockReturnValueOnce(first).mockResolvedValue({data:{rows:[],total:0}});
  const pending=read({rpc},['2026-06','2026-05','2026-04','2026-03','2026-02','2026-01']);
  await Promise.resolve();await Promise.resolve();expect(rpc).toHaveBeenCalledTimes(1);
  release({data:{rows:[row('2026-06')],total:1}});expect(await pending).toEqual([{...row('2026-06'),evidenceFormat:'EVA_APPROVED',version_number:7}]);
  expect(rpc).toHaveBeenCalledTimes(12);
  expect(rpc.mock.calls.map((c:any)=>[c[1].p_month,c[1].p_scope])).toEqual(['2026-06','2026-05','2026-04','2026-03','2026-02','2026-01'].flatMap(m=>[[m,'CUSTOMER'],[m,'UNIT']]));
 });
 it('retains tenant, actor, role, mode and unit on every page without a cache',async()=>{
  const rpc=jest.fn().mockResolvedValue({data:{rows:[],total:0}});await read({rpc});await read({rpc});expect(rpc).toHaveBeenCalledTimes(4);
  for(const [name,args] of rpc.mock.calls)expect([name,args]).toEqual(['eva_scoped_closing_action',expect.objectContaining({p_org:'org',p_actor:'actor',p_role:'role',p_unit:'unit',p_action:'history',p_disclose:false,p_mode:'DOCUMENTED',p_platform:false,p_id:null})]);
 });
 it('preserves an explicit platform operation context',async()=>{const rpc=jest.fn().mockResolvedValue({data:{rows:[],total:0}});await read({rpc},['2026-04'],{...tenant,accessMode:'platform_operation'});expect(rpc.mock.calls.every(c=>c[1].p_platform===true)).toBe(true);});
 it('collects complete pages in their original order before the next scope',async()=>{
  const rpc=jest.fn().mockResolvedValueOnce({data:{rows:[row('2026-04',{id:'a'})],total:2}}).mockResolvedValueOnce({data:{rows:[row('2026-04',{id:'b'})],total:2}}).mockResolvedValueOnce({data:{rows:[],total:0}});
  expect((await read({rpc})).map(r=>r.id)).toEqual(['a','b']);expect(rpc.mock.calls.map(c=>[c[1].p_scope,c[1].p_body.page])).toEqual([['CUSTOMER',0],['CUSTOMER',1],['UNIT',0]]);
 });
 it.each([{organization_id:'other'},{customer_id:'other'},{month:'2026-05'}])('stops on foreign history %j',async extra=>{const rpc=jest.fn().mockResolvedValue({data:{rows:[row('2026-04',extra)],total:1}});await expect(read({rpc})).rejects.toThrow('fora do escopo');expect(rpc).toHaveBeenCalledTimes(1);});
 it.each([{rows:[],total:101},{rows:[],total:-1},{rows:[],total:'1'},{rows:null,total:0},{rows:[],total:1}])('does not accept partial or invalid history %j',async data=>{const rpc=jest.fn().mockResolvedValue({data});await expect(read({rpc})).rejects.toThrow();expect(rpc).toHaveBeenCalledTimes(1);});
 it('stops after ten nonconcluding pages rather than returning a partial history',async()=>{const rpc=jest.fn().mockResolvedValue({data:{rows:[row()],total:100}});await expect(read({rpc})).rejects.toThrow('truncado');expect(rpc).toHaveBeenCalledTimes(10);});
 it.each(['42501','40001','23505','XX000'])('preserves %s failure without opening the next request',async code=>{const rpc=jest.fn().mockResolvedValue({error:{code}});await expect(read({rpc})).rejects.toThrow();expect(rpc).toHaveBeenCalledTimes(1);});
 it('aborts an unresponsive history request and never proceeds to another scope',async()=>{
  jest.useFakeTimers();let signal!:AbortSignal;const promise=new Promise(()=>{}),request=Object.assign(promise,{abortSignal:jest.fn((s:AbortSignal)=>{signal=s;return promise;})}),rpc=jest.fn(()=>request);
  const pending=read({rpc});const rejected=expect(pending).rejects.toBeInstanceOf(EvaReadUnavailable);
  await jest.advanceTimersByTimeAsync(25000);await rejected;expect(signal.aborted).toBe(true);expect(rpc).toHaveBeenCalledTimes(1);expect(jest.getTimerCount()).toBe(0);
 });
});
