import {ReportsService} from './reports.service';
import {PERMISSIONS as P} from '../../common/constants/permissions';
describe('report access boundary',()=>{
 const permissions=[P.DOCUMENTS_REPORTS_VIEW,P.DOCUMENTS_REPORTS_CREATE,P.ORGANIZATION_CONTRACTS_VIEW];
 const t:any={organizationId:'o',userId:'actor',role:'gestor',permissions};
 let licenses:any,db:any,service:ReportsService;
 beforeEach(()=>{licenses={requireEntitlement:jest.fn().mockResolvedValue({})};db={getClient:()=>({rpc:jest.fn().mockResolvedValue({data:null,error:null})})};service=new ReportsService(db,licenses,{} as any);});
 it.each(['consulta','admin_platform','unknown'])('denies role %s without explicit organization session',async role=>{await expect(service.access({...t,role})).rejects.toThrow();expect(licenses.requireEntitlement).not.toHaveBeenCalled();});
 it('requires both view permissions',async()=>{await expect(service.access({...t,permissions:[P.DOCUMENTS_REPORTS_VIEW]})).rejects.toThrow();});
 it('requires separate generation permission',async()=>{await expect(service.access({...t,permissions:[P.DOCUMENTS_REPORTS_VIEW,P.ORGANIZATION_CONTRACTS_VIEW]},true)).rejects.toThrow();});
 it('checks both report and financial license capabilities',async()=>{await service.access(t);expect(licenses.requireEntitlement.mock.calls).toEqual([['o','report_generation'],['o','free_market_management']]);});
 it('blocks revoked live database membership',async()=>{service=new ReportsService({getClient:()=>({rpc:async()=>({error:{code:'42501'}})})} as any,licenses,{} as any);await expect(service.access(t)).rejects.toThrow('revogado');});
 it('requires active entitlement on every access',async()=>{licenses.requireEntitlement.mockRejectedValue(new Error('license expired'));await expect(service.access(t)).rejects.toThrow('license expired');});
});
