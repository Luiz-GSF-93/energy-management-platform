import {CceeDataWorker} from './ccee-data.worker';
const basis={unit:'kWh',sourceReference:'Reviewed operator confirmation',confirmedBy:'admin',confirmedAt:'2026-10-27T15:00:00Z',bindingRevision:4};
describe('Audited automatic reading integration',()=>{
 let env:NodeJS.ProcessEnv;beforeEach(()=>{env={...process.env};Object.assign(process.env,{CCEE_DATA_WORKSPACE_ENABLED:'true',CCEE_SYNC_WORKER_ENABLED:'true',CCEE_PRIVATE_READ_ENABLED:'true',CCEE_DRI_READ_ENABLED:'false',CCEE_AUTOMATIC_READ_ENABLED:'true'});});afterEach(()=>{process.env=env;});
 const setup=(patch:any={},unit:any=basis,budgetError:any=null)=>{
  const job={id:'j',organization_id:'org_default',actor_id:'admin',authorization_id:'b',kind:'MEASUREMENTS',lease_id:'lease',binding:{id:'b',revision:4},...patch};
  const rpc=jest.fn(async(name:string,args?:any)=>name==='ccee_claim_reading'?{data:job}:name==='ccee_auto_policy_action'?{data:{organizationId:job.organization_id,unitBasis:unit}}:name==='ccee_assert_reading'?{data:{organization_id:job.organization_id,lease_id:job.lease_id}}:name==='ccee_communication_reserve'?{data:budgetError?null:{reserved:true},error:budgetError}: {data:{recorded:true}});
  const execute=jest.fn(async(_job:any,validate:any,reserve?:()=>Promise<void>)=>{await validate();await reserve?.();return{complete:false,requests:1,data:{rows:[]}};});
  return{job,rpc,execute,worker:new CceeDataWorker({getClient:()=>({rpc})} as any,{execute} as any)};
 };
 it('loads current binding evidence and reserves before fetching',async()=>{const c=setup();await c.worker.runOnce();expect(c.execute.mock.calls[0][0].binding.unit_basis).toEqual(basis);expect(c.rpc.mock.calls.find(x=>x[0]==='ccee_communication_reserve')?.[1]).toEqual({p_id:'j',p_lease:'lease',p_market:false});expect(c.rpc.mock.calls.at(-1)?.[0]).toBe('ccee_finish_reading');});
 it('stops before calling the connector when the unit revision changed',async()=>{const c=setup({}, {...basis,bindingRevision:3});await c.worker.runOnce();expect(c.execute).not.toHaveBeenCalled();expect(c.rpc.mock.calls.at(-1)?.[1].p_error).toBe('ACCESS_CHANGED');});
 it('records a budget stop rather than proceeding as if fetch succeeded',async()=>{const c=setup({},basis,{message:'COMMUNICATION_REQUEST_BUDGET_EXHAUSTED'});await c.worker.runOnce();expect(c.rpc.mock.calls.at(-1)?.[1].p_error).toBe('BUDGET_EXHAUSTED');expect(c.rpc.mock.calls.at(-1)?.[1].p_result).toBeNull();});
 it('preserves other organizations under the existing configuration',async()=>{const c=setup({organization_id:'foreign'});await c.worker.runOnce();expect(c.rpc.mock.calls.some(x=>x[0]==='ccee_auto_policy_action'||x[0]==='ccee_communication_reserve')).toBe(false);});
 it('does nothing when the read worker is off',async()=>{process.env.CCEE_SYNC_WORKER_ENABLED='false';const c=setup();await c.worker.runOnce();expect(c.rpc).not.toHaveBeenCalled();});
});
