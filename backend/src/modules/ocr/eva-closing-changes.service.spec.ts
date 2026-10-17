import {EvaClosingChangesService} from './eva-closing-changes.service';
import {PERMISSIONS as P} from '../../common/constants/permissions';
const id='00000000-0000-4000-8000-000000000001',b={consumerUnitId:id,month:'2026-09',id,hash:'a'.repeat(64)},t:any={organizationId:'org',userId:'actor',roleId:'operator',permissions:[P.INTELLIGENCE_AI_USE]};
function setup(on=true){const rpc=jest.fn().mockResolvedValue({data:{id,state:'PROPOSED'}}),history=jest.fn().mockResolvedValue({canPrepare:true,rows:[]});const service=new EvaClosingChangesService({get:()=>on?'true':'false'} as any,{getClient:()=>({rpc})} as any,{history} as any);return {service,rpc,history};}
describe('closing change service',()=>{
 it('performs no access or mutation while disabled',async()=>{const x=setup(false);await expect(x.service.preview({...b,question:'Altere honorário fixo para 5'},t)).rejects.toThrow();expect(x.history).not.toHaveBeenCalled();expect(x.rpc).not.toHaveBeenCalled()});
 it('requires AI permission and explicit confirmation',async()=>{const x=setup();await expect(x.service.action({...b,acknowledge:true},{...t,permissions:[]},'confirm')).rejects.toThrow();await expect(x.service.action({...b,acknowledge:false},t,'confirm')).rejects.toThrow();expect(x.rpc).not.toHaveBeenCalled()});
 it('status/cancel cannot silently confirm',async()=>{const x=setup();await x.service.action(b,t,'status');expect(x.rpc.mock.calls[0][1]).toMatchObject({p_action:'status',p_body:{hash:b.hash}})});
 it('returns source races without retrying or charging locally',async()=>{const x=setup();x.rpc.mockResolvedValue({error:{code:'40001'}});await expect(x.service.action({...b,acknowledge:true},t,'confirm')).rejects.toThrow('mudaram');expect(x.rpc).toHaveBeenCalledTimes(1)});
 it('rejects obsolete or cross-scope source versions before proposal',async()=>{const x=setup();await expect(x.service.preview({...b,question:'Altere honorário fixo para 5'},t)).rejects.toThrow();expect(x.rpc).not.toHaveBeenCalled()});
});
