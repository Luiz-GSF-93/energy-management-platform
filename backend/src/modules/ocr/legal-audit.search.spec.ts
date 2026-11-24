import {LegalAuditService} from './legal-audit.service';
import {PERMISSIONS as P} from '../../common/constants/permissions';
describe('legal audit scoped search',()=>{
 const tenant:any={organizationId:'a',userId:'00000000-0000-4000-8000-000000000001',roleId:'op',scope:'organization',role:'operacional',permissions:[P.DOCUMENTS_VIEW]};
 const setup=()=>{const rpc=jest.fn().mockResolvedValue({data:{rows:[],hasMore:false},error:null}),ai={interpret:jest.fn(),available:jest.fn()},db={getClient:()=>({rpc})};return {rpc,ai,s:new LegalAuditService(db as any,{get:()=> 'true'} as any,ai as any)};};
 it('uses only the scoped read RPC; no AI or credits',async()=>{const {s,rpc,ai}=setup();await s.search(tenant,{q:'seguro garantia',offset:'20'});expect(rpc).toHaveBeenCalledWith('legal_audit_search',expect.objectContaining({p_org:'a',p_actor:tenant.userId,p_query:'seguro garantia',p_offset:20}));expect(ai.interpret).not.toHaveBeenCalled();expect(ai.available).not.toHaveBeenCalled();});
 it('rejects invalid filters and other modules',async()=>{const {s,rpc}=setup();for(const b of [{q:'ab'},{q:'abc',module:'trading'},{q:'abc',kind:'INVOICE'},{q:'abc',offset:'-1'},{q:'abc',customerId:'foreign'},{q:'a'.repeat(501)}])await expect(s.search(tenant,b)).rejects.toThrow();expect(rpc).not.toHaveBeenCalled();});
 it('rejects external, global and unlicensed contexts before returning data',async()=>{const {s,rpc}=setup();for(const t of [{...tenant,scope:'global'},{...tenant,role:'cliente'},{...tenant,permissions:[]}])await expect(s.search(t,{q:'garantia'})).rejects.toThrow();expect(rpc).not.toHaveBeenCalled();rpc.mockResolvedValue({data:null,error:{code:'42501'}});await expect(s.search(tenant,{q:'garantia'})).rejects.toThrow();});
});
