import {EnergyMapGeocodingWorker} from './geocoding.worker';
import {GeocodeFailure} from './geocoding.provider';
const job={jobId:'11111111-1111-4111-8111-111111111111',leaseId:'22222222-2222-4222-8222-222222222222',organizationId:'o1',actorId:'a1',address:{address:'Rua Um 100',city:'Ribeirão Preto',state:'SP'}};
function setup(configured=true,orgs='o1',maps='o1'){
 const rpc=jest.fn().mockResolvedValue({data:null,error:null}),locate=jest.fn().mockResolvedValue([]);
 const worker=new EnergyMapGeocodingWorker({getClient:()=>({rpc})} as any,{get:(k:string)=>k==='ENERGY_MAP_ORGANIZATIONS'?maps:orgs} as any,{configured:()=>configured,locate} as any);
 return {worker,rpc,locate};
}
describe('durable geocoding worker',()=>{
 it.each([[false,'o1','o1'],[true,'','o1'],[true,'o1','o2']])('never dispatches outside configured pilot',async(configured,orgs,maps)=>{const s=setup(configured,orgs,maps);await s.worker.runOnce();expect(s.rpc).not.toHaveBeenCalled();expect(s.locate).not.toHaveBeenCalled();});
 it('accepts only one leased canonical address and persists result for review',async()=>{const s=setup();s.rpc.mockResolvedValueOnce({data:job});await s.worker.runOnce();expect(s.rpc.mock.calls[0]).toEqual(['dispatch_energy_map_geocoding',{p_orgs:['o1']}]);expect(s.locate).toHaveBeenCalledWith(expect.objectContaining(job.address));expect(s.rpc.mock.calls[1]).toEqual(['finish_energy_map_geocoding',expect.objectContaining({p_org:'o1',p_actor:'a1',p_job:job.jobId,p_lease:job.leaseId,p_candidates:[],p_error:null})]);});
 it('rejects a cross-organization response before external disclosure',async()=>{const s=setup();s.rpc.mockResolvedValueOnce({data:{...job,organizationId:'o2'}});await expect(s.worker.runOnce()).rejects.toThrow();expect(s.locate).not.toHaveBeenCalled();});
 it('records provider failure without retrying a paid request',async()=>{const s=setup();s.rpc.mockResolvedValueOnce({data:job});s.locate.mockRejectedValue(new GeocodeFailure('TIMEOUT'));await s.worker.runOnce();expect(s.locate).toHaveBeenCalledTimes(1);expect(s.rpc.mock.calls[1][1]).toMatchObject({p_candidates:[],p_error:'TIMEOUT'});});
 it('a failed completion never triggers another external call',async()=>{const s=setup();s.rpc.mockResolvedValueOnce({data:job}).mockResolvedValueOnce({error:{code:'42501'}});await expect(s.worker.runOnce()).rejects.toThrow();await s.worker.runOnce();expect(s.locate).toHaveBeenCalledTimes(1);});
 it('serializes local ticks and stops after shutdown',async()=>{const s=setup();let release:(v:any)=>void=()=>{};s.rpc.mockImplementationOnce(()=>new Promise(r=>release=r));const first=s.worker.runOnce();await s.worker.runOnce();expect(s.rpc).toHaveBeenCalledTimes(1);release({data:null});await first;s.worker.onModuleDestroy();await s.worker.runOnce();expect(s.rpc).toHaveBeenCalledTimes(1);});
});
