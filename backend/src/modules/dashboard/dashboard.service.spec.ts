import {DashboardService} from './dashboard.service';
import {PERMISSIONS as P} from '../../common/constants/permissions';

describe('Dashboard scope and counts',()=>{
 let service:DashboardService, calls:any[], result:any, license:any;
 beforeEach(()=>{
  calls=[];result={count:7,error:null};license=jest.fn().mockResolvedValue(null);
  const client={from:jest.fn((table:string)=>{
   const filters:any[]=[];calls.push({table,filters});
   const q:any={select:jest.fn(()=>q),eq:jest.fn((...v:any[])=>{filters.push(v);return q;}),is:jest.fn((...v:any[])=>{filters.push(v);return q;}),then:(ok:any,bad:any)=>Promise.resolve(result).then(ok,bad)};return q;
  })};
  service=new DashboardService({getClient:()=>client} as any,{resolveEffectiveLicense:license} as any);
 });
 const context=(permissions:string[])=>({organizationId:'org-a',permissions} as any);
 it('counts only the authenticated organization and granted areas',async()=>{
  const data=await service.organization(context([P.ORGANIZATION_CUSTOMERS_VIEW,P.ORGANIZATION_USERS_VIEW]));
  expect(calls).toEqual([{table:'customers',filters:[['organization_id','org-a'],['deleted_at',null]]},{table:'organization_members',filters:[['organization_id','org-a'],['status','active']]}]);
  expect(data.metrics.map(m=>m.value)).toEqual([7,7]);expect(license).not.toHaveBeenCalled();
 });
 it('does not query forbidden areas',async()=>{expect((await service.organization(context([]))).metrics).toEqual([]);expect(calls).toEqual([]);});
 it('rejects a missing tenant before any database read',async()=>{await expect(service.organization({permissions:[]} as any)).rejects.toThrow();expect(calls).toEqual([]);});
 it('does not bypass document licensing',async()=>{await service.organization(context([P.DOCUMENTS_VIEW]));expect(calls).toEqual([]);expect(license).toHaveBeenCalledWith('org-a');});
 it('counts documents only with a licensed module and permission',async()=>{
  license.mockResolvedValue({document_management:true});await service.organization(context([P.DOCUMENTS_VIEW]));
  expect(calls).toEqual([{table:'documents',filters:[['organization_id','org-a']]},{table:'documents',filters:[['organization_id','org-a'],['processing_status','PENDING']]}]);
 });
 it('does not expose license details without license permission',async()=>{
  license.mockResolvedValue({document_management:true,license_type:'private'});expect(await service.organization(context([P.DOCUMENTS_VIEW]))).not.toHaveProperty('license');
 });
 it('fails instead of showing zero on database errors',async()=>{result={count:null,error:{message:'private'}};await expect(service.organization(context([P.ORGANIZATION_USERS_VIEW]))).rejects.toThrow('Não foi possível');});
 it('rejects missing count even without an error',async()=>{result={count:null,error:null};await expect(service.platform()).rejects.toThrow();});
 it('returns a real zero and excludes deleted organizations',async()=>{result.count=0;const data=await service.platform();expect(data.metrics[0].value).toBe(0);expect(calls[0]).toEqual({table:'organizations',filters:[['deleted_at',null]]});});
});
