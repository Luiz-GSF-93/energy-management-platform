import {EvaOperationalFlowService} from './eva-operational-flow.service';
describe('existing CCEE pilot keeps its gates while sharing preparation slots',()=>{
 const original=process.env.EVA_MANUAL_PREPARATION_ASYNC_ENABLED;
 afterEach(()=>{if(original===undefined)delete process.env.EVA_MANUAL_PREPARATION_ASYNC_ENABLED;else process.env.EVA_MANUAL_PREPARATION_ASYNC_ENABLED=original;});
 it('routes only the begin-write boundary through the coordinated existing policy',async()=>{
  process.env.EVA_MANUAL_PREPARATION_ASYNC_ENABLED='true';const rpc=jest.fn(async()=>({data:{accepted:true}}));const service=new EvaOperationalFlowService({getClient:()=>({rpc})} as any,{} as any,{} as any,{} as any,{} as any);
  await (service as any).rpc('eva_flow_worker',{p_action:'begin_write',p_id:'job',p_lease:'lease'});expect(rpc).toHaveBeenCalledWith('eva_coordinated_flow_begin',{p_id:'job',p_lease:'lease'});
  await (service as any).rpc('eva_flow_worker',{p_action:'context',p_id:'job',p_lease:'lease'});expect(rpc).toHaveBeenLastCalledWith('eva_flow_worker',{p_action:'context',p_id:'job',p_lease:'lease'});
 });
 it('yields a busy slot without acknowledging any business write',async()=>{
  process.env.EVA_MANUAL_PREPARATION_ASYNC_ENABLED='true';const rpc=jest.fn(async()=>({data:{deferred:true}}));const service=new EvaOperationalFlowService({getClient:()=>({rpc})} as any,{} as any,{} as any,{} as any,{} as any);
  await expect((service as any).rpc('eva_flow_worker',{p_action:'begin_write',p_id:'job',p_lease:'lease'})).rejects.toThrow('PREPARATION_SLOT_BUSY');expect(rpc).toHaveBeenCalledTimes(1);
 });
});
