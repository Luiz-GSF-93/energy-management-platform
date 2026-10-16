import {EvaTariffWorkbenchService} from './eva-tariff-workbench.service';
import * as globalRule from './eva-global-model';
const u='00000000-0000-4000-8000-000000000001',id='00000000-0000-4000-8000-000000000002',t:any={organizationId:'org',userId:'actor',roleId:'role'};
function fixture(enabled=true){const rpc=jest.fn().mockResolvedValue({data:{canWrite:true,events:[]}}),queue={enqueue:jest.fn(),reviewSource:jest.fn()},s=new EvaTariffWorkbenchService({getClient:()=>({rpc})} as any,{get:(k:string)=>k==='EVA_TARIFF_WORKBENCH_ENABLED'&&enabled?'true':'false'} as any,queue as any);return {s,rpc,queue}}
describe('Tariff model service',()=>{
 it('keeps new workflow disabled without DB or provider access',async()=>{const x=fixture(false);expect(await x.s.inspect({},t)).toEqual({enabled:false});expect(x.rpc).not.toHaveBeenCalled()});
 it('rejects invalid scope and arbitrary action',async()=>{const x=fixture();await expect(x.s.inspect({consumerUnitId:'other',month:'2026-09'},t)).rejects.toThrow();await expect(x.s.command({consumerUnitId:u,month:'2026-09',requestId:id,action:'grant',data:{}},t)).rejects.toThrow()});
 it('never enqueues a paid call with its dedicated flag off',async()=>{const x=fixture();await expect(x.s.command({consumerUnitId:u,month:'2026-09',requestId:id,action:'enqueue',data:{documentId:id}},t)).rejects.toThrow('desligada');expect(x.queue.enqueue).not.toHaveBeenCalled()});
 it('rejects lowering the quality criterion below 90%',async()=>{const x=fixture();await expect(x.s.command({consumerUnitId:u,month:'2026-09',requestId:id,action:'import',data:{documentId:id,threshold:0.8,reason:'Conferência suficiente para teste.'}},t)).rejects.toThrow();expect(x.queue.reviewSource).not.toHaveBeenCalled()});
 it('requires authorization before loading an invoice',async()=>{const x=fixture();x.rpc.mockResolvedValue({data:{canWrite:false}});await expect(x.s.command({consumerUnitId:u,month:'2026-09',requestId:id,action:'import',data:{documentId:id,threshold:0.9,reason:'Conferência suficiente para teste.'}},t)).rejects.toThrow();expect(x.queue.reviewSource).not.toHaveBeenCalled()});
 it('maps source races without retry',async()=>{const x=fixture();x.rpc.mockResolvedValue({error:{code:'40001'}});await expect(x.s.inspect({consumerUnitId:u,month:'2026-09'},t)).rejects.toThrow('mudou');expect(x.rpc).toHaveBeenCalledTimes(1)});
 it('keeps the global rule explicitly disabled without changing current processing flags',async()=>{const x=fixture();expect(await x.s.inspect({consumerUnitId:u,month:'2026-09'},t)).toMatchObject({globalScoreEnabled:false,callsEnabled:false});expect(x.queue.reviewSource).not.toHaveBeenCalled()});
 it('does not homologate a V2 revision while the global rule is disabled',async()=>{const x=fixture();x.rpc.mockResolvedValue({data:{canWrite:true,imports:[{id,payload:{evaluation:{version:2}}}]}});await expect(x.s.command({consumerUnitId:u,month:'2026-09',requestId:u,action:'qualify',data:{importId:id,acknowledge:true,note:'Conferência da revisão global e suas evidências.'}},t)).rejects.toThrow('global desligada');expect(x.rpc).toHaveBeenCalledTimes(1)});
 it('sends a bounded V2 summary once and preserves all 84 mapped values when AI fails',async()=>{
  const evaluation:any={version:2,score:0.986,threshold:0.9,completion:1,confidenceCoverage:1,consistent:true,complete:true,state:'READY_FOR_REVIEW',sections:[],reviewReasons:[],monetaryCorrections:[],fields:Array.from({length:84},(_,i)=>({key:'field-'+i,value:'PRIVATE_VALUE',filled:true,source:'OCR'}))};
  const spy=jest.spyOn(globalRule,'globalModelConfidence').mockReturnValue(evaluation);
  try{
   const rpc=jest.fn(async(_name,args)=>({data:args.p_action==='inspect'?{canWrite:true}:args.p_action==='adviceReserve'?{acquired:true}:{event:{payload:{result:{importId:id}}}}}));
   const unit:any={id:u,distributor:'Teste',tariff_group:'A',tariff_subgroup:'A4',tariff_modality:'GREEN'};
   const query:any={select:()=>query,eq:()=>query,maybeSingle:async()=>({data:unit})};
   const db:any={getClient:()=>({rpc,from:()=>query})},config:any={get:()=> 'true'};
   const queue:any={reviewSource:jest.fn(async()=>({doc:{id,consumer_unit_id:u,reference_month:'2026-09-01',file_hash:'a'.repeat(64)},raw:{},assessment:{intake:{checks:[]}}}))};
   const ai:any={interpret:jest.fn(async()=>({state:'FAILED',message:'Resposta rejeitada',consumptionState:'SETTLED'}))};
   await new EvaTariffWorkbenchService(db,config,queue,ai).command({consumerUnitId:u,month:'2026-09',requestId:id,action:'import',data:{documentId:id,threshold:0.9,reason:'Homologação sintética da preparação global.'}},t);
   expect(ai.interpret).toHaveBeenCalledTimes(1);const call=ai.interpret.mock.calls[0];expect(call[2]).toHaveLength(1);expect(JSON.stringify(call[2])).not.toContain('PRIVATE_VALUE');expect(call[5]).toEqual({settleRejectedUsage:true});
   const finish=rpc.mock.calls.find((c:any)=>c[1].p_action==='adviceFinish')![1] as any;expect(finish.p_body.payload.advice.preparation.fields).toHaveLength(84);expect(queue.reviewSource).toHaveBeenCalledTimes(1);
  }finally{spy.mockRestore()}
 });
});
