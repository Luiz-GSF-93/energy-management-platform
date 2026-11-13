import {CalculationAutofillService} from './calculation-autofill.service';
import {PERMISSIONS as P} from '../../common/constants/permissions';
describe('calculation history conflict boundary',()=>{
 const tenant:any={scope:'organization',organizationId:'org',userId:'actor',roleId:'role',role:'operacional',permissions:[P.DOCUMENTS_VIEW,P.ORGANIZATION_CONTRACTS_VIEW]};
 const query={consumerUnitId:'00000000-0000-4000-8000-000000000001',month:'2026-05'};
 it.each([['PT409',409],['40001',409],['42501',403],['XX000',503]])('preserves %s semantics without replay',async(code,status)=>{
  const rpc=jest.fn().mockResolvedValue({error:{code,message:'PRIVATE_SQL_CANARY'}}),licenses={requireEntitlement:jest.fn().mockResolvedValue(undefined)};
  const service=new CalculationAutofillService({getClient:()=>({rpc})} as any,licenses as any,{} as any,{get:()=> 'true'} as any,{} as any);
  await expect(service.history(query,tenant)).rejects.toMatchObject({status});
  expect(rpc).toHaveBeenCalledTimes(1);expect(rpc.mock.calls[0][1]).toMatchObject({p_org:'org',p_actor:'actor',p_role:'role',p_platform:false,p_action:'history',p_unit:query.consumerUnitId});
  expect(licenses.requireEntitlement).toHaveBeenCalledWith('org','document_management');expect(licenses.requireEntitlement).toHaveBeenCalledWith('org','free_market_management');
 });
});
