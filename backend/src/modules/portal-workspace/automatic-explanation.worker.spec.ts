import {AutomaticExplanationWorker} from './automatic-explanation.worker';
describe('Optional explanation isolation',()=>{
 const before={...process.env};afterEach(()=>{process.env=before;});
 function fixture(){
  process.env={...before,EVA_AUTOMATIC_INTAKE_ENABLED:'true',EVA_AUTOMATIC_INTAKE_ORGANIZATIONS:'org'};
  const context={organizationId:'org',documentId:'doc',delegate:{userId:'actor',roleId:'role',role:'gestor'}};
  const rpc=jest.fn(async(_n,b)=>({data:b.p_action==='claim'?{id:'job',leaseId:'lease'}:b.p_action==='assert'?context:{stored:true}}));
  const assistant={inspect:jest.fn(async()=>({unitName:'Synthetic',month:'2026-07',counts:{blockers:0,reviews:1},records:{measurements:{status:'REVIEW'},costs:{status:'REVIEW'}}}))},ai={interpret:jest.fn(async()=>({state:'READY'}))};
  return {rpc,assistant,ai,context,worker:new AutomaticExplanationWorker({getClient:()=>({rpc})} as any,assistant as any,ai as any)};
 }
 it('makes no model request if the durable claim fails',async()=>{const f=fixture();f.rpc.mockResolvedValueOnce({error:{code:'offline'}} as any);await expect(f.worker.runOnce()).rejects.toThrow();expect(f.ai.interpret).not.toHaveBeenCalled();});
 it('uses the current tenant delegate and finishes only the optional task',async()=>{const f=fixture();await f.worker.runOnce();expect(f.ai.interpret).toHaveBeenCalledTimes(1);expect((f.ai.interpret.mock.calls as any)[0][0]).toMatchObject({organizationId:'org',userId:'actor'});expect(f.rpc.mock.calls.at(-1)?.[1]).toMatchObject({p_action:'finish',p_id:'job',p_lease:'lease'});});
 it('rechecks authorization after plan inspection before a paid request',async()=>{const f=fixture(),original=f.rpc.getMockImplementation()!;let assertions=0;f.rpc.mockImplementation(async(n,b)=>b.p_action==='assert'&&++assertions===2?{error:{code:'42501'}} as any:original(n,b));await f.worker.runOnce();expect(f.ai.interpret).not.toHaveBeenCalled();expect(f.rpc.mock.calls.at(-1)?.[1]).toMatchObject({p_action:'finish',p_error:'EXPLANATION_UNCONFIRMED'});});
 it('rejects a tenant outside the enabled organizations before inspecting a source',async()=>{const f=fixture();f.context.organizationId='foreign';await f.worker.runOnce();expect(f.assistant.inspect).not.toHaveBeenCalled();expect(f.ai.interpret).not.toHaveBeenCalled();});
});
