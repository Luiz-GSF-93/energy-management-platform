import {CalculationAutofillService} from './calculation-autofill.service';
import {PERMISSIONS as P} from '../../common/constants/permissions';
describe('Audited interrupted preparation',()=>{
 const hash='a'.repeat(64),id='00000000-0000-4000-8000-000000000001';
 const tenant:any={userId:id,organizationId:'org',roleId:'admin',role:'admin_org',permissions:[P.DOCUMENTS_VIEW,P.ORGANIZATION_CONTRACTS_VIEW,P.ENERGIA_OCR_PROCESS,P.ORGANIZATION_CONTRACTS_CREATE]};
 const body={consumerUnitId:id,month:'2026-05',runId:id,basis:hash,sourceHash:hash,token:hash,note:'Original worker stopped after backend replacement; sources checked.',acknowledge:true};
 const setup=()=>{const rpc=jest.fn().mockResolvedValue({data:{id,state:'PARTIAL',canPublish:false}}),s=new CalculationAutofillService({getClient:()=>({rpc})} as any,{requireEntitlement:jest.fn()} as any,{} as any,{get:()=> 'true'} as any,{} as any);const context=jest.spyOn(s as any,'context').mockResolvedValue({available:true,token:hash,basis:hash,sourceHash:hash});return {s,rpc,context};};
 it('appends a partial result using the real administrator without preparing or approving',async()=>{const {s,rpc}=setup();await expect(s.reconcile(body,tenant)).resolves.toMatchObject({state:'PARTIAL',canPublish:false});expect(rpc).toHaveBeenCalledWith('calculation_autofill_reconcile',expect.objectContaining({p_actor:id,p_org:'org',p_body:expect.objectContaining({note:body.note})}));});
 it('rejects stale evidence before any mutation',async()=>{const {s,rpc,context}=setup();context.mockResolvedValue({available:true,token:'b'.repeat(64),sourceHash:hash});await expect(s.reconcile(body,tenant)).rejects.toThrow();expect(rpc).not.toHaveBeenCalled();});
 it('requires explicit interruption acknowledgement',async()=>{const {s,rpc}=setup();await expect(s.reconcile({...body,acknowledge:false},tenant)).rejects.toThrow();expect(rpc).not.toHaveBeenCalled();});
 it('does not let an operational author reconcile another execution',async()=>{const {s,rpc}=setup();await expect(s.reconcile(body,{...tenant,role:'operacional'})).rejects.toThrow();expect(rpc).not.toHaveBeenCalled();});
});

