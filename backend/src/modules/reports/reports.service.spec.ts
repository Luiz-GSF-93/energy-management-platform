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
 it('captures the actual registration column and primary contact without a parallel code field',async()=>{
  const customerId='00000000-0000-4000-8000-000000000010',unitId='00000000-0000-4000-8000-000000000011',sourceId='00000000-0000-4000-8000-000000000012',hash='a'.repeat(64);
  const client:any={from:(table:string)=>{let columns='';const q:any={select:(s:string)=>{columns=s;return q;},eq:()=>q,is:()=>q,maybeSingle:async()=>({data:table==='customers'?{id:customerId,company_name:'Empresa',contact_name:'Consultor',contact_email:'test@example.invalid',status:'ACTIVE'}:table==='consumer_units'?{id:unitId,customer_id:customerId,name:'Unidade',consumer_unit_number:'40045612',status:'ACTIVE'}:null,error:table==='consumer_units'&&columns.split(',').includes('code')?{code:'42703'}:null})};return q;},rpc:async(name:string,args:any)=>({data:name==='capture_published_report'?{id:'report',organization_id:'o',customer_id:customerId,consumer_unit_id:unitId,body:args.p_body,payload_hash:args.p_hash}:null,error:null})};
  const primary={totals:{acr:'100.00',aclAfterFees:'90.00',savingsAfterFees:'10.00'},publicationCount:1,publications:[{id:sourceId,customerId,month:'2026-08',version:1,payloadHash:hash,publishedAt:'2026-09-01T12:00:00Z',units:[{id:unitId}]}],invoices:[{unitId,groupId:sourceId,payloadHash:hash,findings:[]}],period:{from:'2026-08',to:'2026-08'},months:[],unavailable:[],coverage:{},disclosure:'Publicado'};
  const financial:any={reports:jest.fn().mockResolvedValue({primary})};service=new ReportsService({getClient:()=>client} as any,licenses,financial);
  const result=await service.create({kind:'OPERATIONAL',customerId,unitId,from:'2026-08',to:'2026-08',requestId:'00000000-0000-4000-8000-000000000013'},t);
  expect(result.body.header.unitCode).toBe('40045612');expect(result.body.header.contactEmail).toBe('test@example.invalid');expect(financial.reports).toHaveBeenCalledWith({from:'2026-08',to:'2026-08',customerId,unitId},t);
 });
});
