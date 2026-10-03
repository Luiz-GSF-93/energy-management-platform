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
describe('published financial dashboard',()=>{
 it('counts the latest published customer/month once across units and excludes newer drafts/approved',async()=>{
  const rows=[...fixture(1),...fixture(2),...fixture(3,'DRAFT'),...fixture(4,'APPROVED'),...fixture(5,'PUBLISHED','foreign').map(r=>({...r,organization_id:'other'}))];const before=JSON.stringify(rows),s=service(rows),result=await s.service.published(period,tenant);
  expect(result).toMatchObject({publicationCount:1,customerCount:1,unitMonthCount:2,totals:{acr:'41944.00',aclAfterFees:'37742.79',savingsAfterFees:'4201.21',savingsPercent:'10.02'}});
  expect(result.rows[0]).toMatchObject({version:2,customerName:'Cenourão',reservations:['Compra sem NF; revisar CCEE.']});
  expect(result.months[1].totals).toBeNull();expect(JSON.stringify(rows)).toBe(before);
  expect(s.filters).toContainEqual(['monthly_energy_settlements','eq','organization_id',org]);expect(s.filters).toContainEqual(['monthly_energy_settlements','eq','status','PUBLISHED']);
 });
 it('represents absence as unavailable, not financial zero',async()=>{const result=await service([]).service.published(period,tenant);expect(result.totals).toBeNull();expect(result.months.every(m=>m.totals===null)).toBe(true);});
 it('adds published months with exact cents and signed savings',async()=>{
  const rows=fixture(1,'PUBLISHED','loss','2026-09');for(const r of rows){Object.assign(r.financial_payload.financial,{acr:'100.00',aclBeforeFees:'200.00',totalFees:'1.01',aclAfterFees:'201.01',savingsBeforeFees:'-100.00',savingsAfterFees:'-101.01'});r.financial_hash=reviewDigest(r.financial_payload);}
  const result=await service([...fixture(),...rows]).service.published(period,tenant);expect(result.totals).toMatchObject({acr:'42044.00',aclAfterFees:'37943.80',savingsAfterFees:'4100.20',savingsPercent:'9.75'});
 });
 it('filters a requested customer and rechecks its ownership',async()=>{const s=service(fixture());await s.service.published({...period,customerId:customer},tenant);expect(s.filters).toContainEqual(['monthly_energy_settlements','eq','customer_id',customer]);});
 it.each([{organizationId:''},{userId:''},{permissions:[]},{role:'cliente'}])('denies invalid scope or access %j before reading settlements',async patch=>{const s=service(fixture());await expect(s.service.published(period,{...tenant,...patch})).rejects.toThrow();expect(s.filters.some(f=>f[0]==='monthly_energy_settlements')).toBe(false);});
 it('requires current licence',async()=>{const s=service(fixture(),{licenseDenied:true});await expect(s.service.published(period,tenant)).rejects.toThrow();expect(s.filters).toEqual([]);});
 it.each([{from:'2026-09',to:'2026-08'},{from:'2025-08',to:'2026-08'},{from:'2026-13',to:'2026-13'},{...period,extra:'forged'}])('rejects invalid filters %j',async filters=>{await expect(service([]).service.published(filters as any,tenant)).rejects.toThrow();});
 it('rejects an ambiguous latest published version',async()=>{await expect(service([...fixture(),...fixture(2,'PUBLISHED','othergroup')]).service.published(period,tenant)).rejects.toThrow('ambígua');});
 it('verifies the hash rather than trusting displayed metadata',async()=>{const rows=fixture();rows[0].financial_payload.financial.acr='1.00';await expect(service(rows).service.published(period,tenant)).rejects.toThrow('integridade');});
 it('rejects unvalidated or changed publications',async()=>{const rows=fixture();rows[1].validation_status='PENDING';await expect(service(rows).service.published(period,tenant)).rejects.toThrow('mudou');});
 it('refuses a potentially truncated result, never issuing partial totals',async()=>{const rows=Array.from({length:500},()=>fixture()).flat();await expect(service(rows).service.published(period,tenant)).rejects.toThrow('nenhum total parcial');});
 it.each(['acr','aclBeforeFees','totalFees','aclAfterFees','savingsBeforeFees','savingsAfterFees'])('refuses missing %s in signed published payload',key=>{
  const rows=fixture();const p={meta:{id:'g',customerId:customer,month:'2026-08'},financial:{...rows[0].financial_payload.financial,[key]:null},reservations:[]};expect(()=>publishedFinancialSummary(org,period,[p])).toThrow('ausente');
 });
});
