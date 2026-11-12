import {MonthlyCostsService} from './monthly-costs.service';
import {MonthlyInputsService} from './monthly-inputs.service';
import {PERMISSIONS as P} from '../../../common/constants/permissions';
describe('operational input validation, separate from closing approval',()=>{
 for(const Service of [MonthlyCostsService,MonthlyInputsService]){
  const service=new Service({} as any,{} as any);
  it(Service.name+' allows authorized operators to confer and validate inputs',()=>{
   for(const role of ['operacional','gestor','admin_org'])expect(service.canValidate({role,permissions:[P.ORGANIZATION_CONTRACTS_UPDATE]} as any)).toBe(true);
  });
  it(Service.name+' rejects read-only profiles and missing edit permission',()=>{
   expect(service.canValidate({role:'consulta',permissions:[P.ORGANIZATION_CONTRACTS_UPDATE]} as any)).toBe(false);
   expect(service.canValidate({role:'operacional',permissions:[]} as any)).toBe(false);
  });
 }
});
