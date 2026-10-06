import {reportPolicy} from './report-policy';
import {ReportPolicyService} from './report-policy.service';
import {PERMISSIONS as P} from '../../common/constants/permissions';
const config={name:'Mensal',customerId:'00000000-0000-4000-8000-000000000010',unitId:'00000000-0000-4000-8000-000000000011',frequency:'MONTHLY',days:[5],hour:9,monthlyLimit:1,kinds:['OPERATIONAL'],formats:['pdf'],channels:['email'],contactIds:['00000000-0000-4000-8000-000000000012']};
describe('report policy boundary',()=>{
 it('normalizes selected configuration without free destinations',()=>expect(reportPolicy({...config,name:' Mensal '})).toEqual(config));
 it.each([{email:'foreign@example.invalid'},{channels:['sms']},{days:[1,15]},{monthlyLimit:2},{days:[0]},{days:[32]},{hour:24},{formats:['csv']},{contactIds:[]},{contactIds:[config.contactIds[0],config.contactIds[0]]},{kinds:['UNKNOWN']}])('rejects invalid configuration %j',change=>expect(()=>reportPolicy({...config,...change})).toThrow());
 it('allows two selected calendar days and both kinds/formats',()=>expect(reportPolicy({...config,frequency:'FORTNIGHTLY',days:[31,15],monthlyLimit:2,kinds:['EXECUTIVE','OPERATIONAL'],formats:['excel','pdf']})).toMatchObject({days:[15,31]}));
 it('requires notification permission in addition to report generation',async()=>{const reports:any={access:jest.fn()};const service=new ReportPolicyService({} as any,reports);await expect(service.access({permissions:[P.DOCUMENTS_REPORTS_CREATE]} as any)).rejects.toThrow();expect(reports.access).not.toHaveBeenCalled();});
 it('reuses authoritative report authorization for configuration',async()=>{const reports:any={access:jest.fn()};const service=new ReportPolicyService({} as any,reports),t:any={permissions:[P.SETTINGS_NOTIFICATIONS_MANAGE]};await service.access(t);expect(reports.access).toHaveBeenCalledWith(t,true);});
});
