import {FinancialSettlementsService} from './financial-settlements.service';
import {publishedFinancialSummary} from './published-financial-summary';
import {reviewDigest} from './review-snapshots.service';
import {PERMISSIONS as P} from '../../../common/constants/permissions';
const org='org',customer='c355d5a0-e672-4110-ac17-05c4ce734df7';
const tenant={organizationId:org,userId:'actor',role:'operacional',roleId:'role',email:'',permissions:[P.ORGANIZATION_CONTRACTS_VIEW]};
const period={from:'2026-08',to:'2026-09'};
function fixture(version=2,status='PUBLISHED',group='group'+version,month='2026-08'){
 const financial={status:'AVAILABLE',acr:'41944.00',aclBeforeFees:'36142.79',totalFees:'1600.00',aclAfterFees:'37742.79',savingsBeforeFees:'5801.21',savingsAfterFees:'4201.21',units:[{id:'u1',name:'Bonfim'},{id:'u2',name:'Outra'}]};
 const payload={formatVersion:'financial-settlement-1.0',sources:{organizationId:org,customerId:customer,month,tables:{customers:[{id:customer,company_name:'Cenourão'}]}},financial,reservations:['Compra sem NF; revisar CCEE.']};
 return financial.units.map(u=>({organization_id:org,customer_id:customer,consumer_unit_id:u.id,month:month+'-01',version_number:version,status,validation_status:'VALIDATED',financial_format:'financial-settlement-1.0',financial_group_id:group,financial_hash:reviewDigest(payload),financial_payload:payload,financial_reservations:payload.reservations,approved_at:'2026-10-02T15:14:34',published_at:'2026-10-02T15:14:52',published_by:'manager',publication_note:'Publicar com ressalvas explícitas.'}));
}
function service(rows:any[],options:{ignoreFilters?:boolean;licenseDenied?:boolean}={}){
 const filters:any[]=[];
 const db={getClient:()=>({from:(table:string)=>{
  const conditions:any[]=[];const chain:any={};
  for(const method of ['select','order','limit'])chain[method]=()=>chain;
  for(const method of ['eq','is','gte','lte'])chain[method]=(key:string,value:any)=>{conditions.push([method,key,value]);filters.push([table,method,key,value]);return chain;};
  const result=()=>({data:table==='customers'?[{id:customer}]:rows.filter(row=>options.ignoreFilters||conditions.every(([m,k,v])=>m==='gte'?row[k]>=v:m==='lte'?row[k]<=v:row[k]===v)),error:null});
  chain.maybeSingle=async()=>({data:conditions.some(([,k,v])=>k==='id'&&v!==customer)?null:{id:customer},error:null});
  chain.then=(resolve:any)=>Promise.resolve(result()).then(resolve);return chain;
 }})};
 const licenses={requireEntitlement:jest.fn(async()=>{if(options.licenseDenied)throw new Error('License denied');})};
 return {service:new FinancialSettlementsService(db as any,licenses as any),filters,licenses};
}

const reportTenant={...tenant,permissions:[P.ORGANIZATION_CONTRACTS_VIEW,P.DOCUMENTS_REPORTS_VIEW]};
describe('authorized published financial reports',()=>{
 it('counts latest only while preserving older published versions in history',async()=>{const f=service([...fixture(1),...fixture(2),...fixture(3,'DRAFT'),...fixture(4,'APPROVED')]),r=await f.service.reports(period,reportTenant);expect(r.primary.totals!.acr).toBe('41944.00');expect(r.history.map(h=>h.version)).toEqual([1,2]);expect(r.history.filter(h=>h.current).map(h=>h.version)).toEqual([2]);expect(r.primary.coverage.unitBreakdownAvailable).toBe(false);expect(f.filters).toContainEqual(['monthly_energy_settlements','eq','organization_id',org]);});
 it('requires report permission as well as contract permission and backend role',async()=>{for(const t of [tenant,{...reportTenant,permissions:[P.DOCUMENTS_REPORTS_VIEW]},{...reportTenant,role:'consulta'}])await expect(service([]).service.reports(period,t)).rejects.toThrow();});
 it('blocks when license unavailable before reading reports',async()=>{await expect(service([], {licenseDenied:true}).service.reports(period,reportTenant)).rejects.toThrow();});
 it('compares published periods, never substitutes zero for missing comparison',async()=>{const r=await service(fixture()).service.reports({...period,compareFrom:'2025-08',compareTo:'2025-08'},reportTenant);expect(r.comparison!.totals).toBeNull();expect(r.comparisonResult!.delta).toBeNull();});
 it.each([{...period,compareFrom:'2025-08'},{...period,compareUnitId:'11111111-1111-4111-8111-111111111111'},{...period,compareFrom:'2025-09',compareTo:'2025-08'},{...period,compareFrom:'2025-01',compareTo:'2026-01'},{...period,extra:'forged'}])('rejects invalid comparison/scope %j',async d=>{await expect(service([]).service.reports(d as any,reportTenant)).rejects.toThrow();});
 it('denies foreign customer using same ownership check',async()=>{await expect(service(fixture()).service.reports({...period,customerId:'11111111-1111-4111-8111-111111111111'},reportTenant)).rejects.toThrow();});
 it('denies foreign unit before report reads',async()=>{const f=service(fixture());await expect(f.service.reports({...period,unitId:'11111111-1111-4111-8111-111111111111'},reportTenant)).rejects.toThrow();expect(f.filters.some(r=>r[0]==='monthly_energy_settlements')).toBe(false);});
 it('refuses a newer publication appearing during history read',async()=>{const captured=await service(fixture(2)).service.published(period,reportTenant),f=service([...fixture(2),...fixture(3)]);jest.spyOn(f.service,'published').mockResolvedValue(captured);await expect(f.service.reports(period,reportTenant)).rejects.toThrow('Histórico mudou');});
 it('checks payload hash before displaying invoice/history',async()=>{const rows=fixture();rows[0].financial_payload.financial.acr='1.00';await expect(service(rows).service.reports(period,reportTenant)).rejects.toThrow('integridade');});
});
