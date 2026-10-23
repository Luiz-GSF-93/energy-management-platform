import {CceeMarketService} from './ccee-market.service';
const t={organizationId:'org',userId:'actor'} as any;
const filters={from:'2026-01-01',to:'2026-12-31'};
describe('market history permissions and hourly status',()=>{
 const ws={canManage:false,bindings:[]};const result={organizationId:'org',rows:[],series:[],dailyHistory:[],schedules:[]};
 function setup(){const rpc=jest.fn(async()=>({data:result,error:null}));const workspace=jest.fn(async()=>ws);return {rpc,workspace,service:new CceeMarketService({getClient:()=>({rpc})} as any,{workspace} as any,{status:()=>({configured:true})} as any)};}
 it('consults live license and permission before any history read',async()=>{const s=setup();s.workspace.mockRejectedValueOnce(Error('revoked'));await expect(s.service.read(t,filters)).rejects.toThrow('revoked');expect(s.rpc).not.toHaveBeenCalled();});
 it('never returns history from another organization',async()=>{const s=setup();s.rpc.mockResolvedValueOnce({data:{...result,organizationId:'foreign'},error:null});await expect(s.service.read(t,filters)).rejects.toThrow('Escopo');});
 it('reports hourly frequency separately from private five-minute granularity',async()=>{const s=setup();expect(await s.service.read(t,filters)).toMatchObject({frequencySeconds:3600,canManage:false,organizationId:'org'});});
 it('forbids configuration for a viewer without granting access implicitly',async()=>{const s=setup();await expect(s.service.schedule(t,null,{action:'configure'})).rejects.toThrow();expect(s.rpc).not.toHaveBeenCalled();});
 it('rejects injection and unbounded private measurement filters',async()=>{const s=setup();await expect(s.service.measurements(t,{authorizationId:'10000000-0000-4000-8000-000000000001',from:'2026-01-01',to:'2026-12-31'})).rejects.toThrow();expect(s.rpc).not.toHaveBeenCalled();});
});
