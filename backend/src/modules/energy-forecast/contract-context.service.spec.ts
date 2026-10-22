import {ContractContextService,CONTRACT_CONTEXT_FORMAT} from './contract-context.service';
import {reportHash} from '../reports/report.projection';
import {PERMISSIONS as P} from '../../common/constants/permissions';
const scope={organizationId:'org-test',customerId:'00000000-0000-4000-8000-000000000001',unitId:'00000000-0000-4000-8000-000000000002'};
const t:any={...scope,userId:'actor',role:'gestor',permissions:[P.ORGANIZATION_CONTRACTS_VIEW,P.DOCUMENTS_REPORTS_VIEW,P.DOCUMENTS_REPORTS_CREATE,P.OPERACAO_EVENTS_VIEW,P.OPERACAO_EVENTS_MANAGE,P.DOCUMENTS_VIEW]};
const contract={id:'synthetic-contract',organization_id:scope.organizationId,customer_id:scope.customerId,consumer_unit_id:scope.unitId,contract_type:'ENERGY_PURCHASE',contract_number:'TEST-1',status:'ACTIVE',start_date:'2026-01-01',end_date:'2026-12-31',contracted_volume_mwh:'100',seasonal_volumes:[]};
describe('contract context integration and organization isolation',()=>{
 let tables:Record<string,any[]>,hidden:boolean,service:ContractContextService,save:jest.Mock;
 beforeEach(()=>{
  hidden=false;save=jest.fn();tables={customers:[{id:scope.customerId,organization_id:scope.organizationId,status:'ACTIVE',deleted_at:null}],consumer_units:[{id:scope.unitId,organization_id:scope.organizationId,customer_id:scope.customerId,status:'ACTIVE'}],energy_contracts:[{...contract}],supplier_billing_rules:[{id:'rule',organization_id:scope.organizationId,customer_id:scope.customerId,consumer_unit_id:scope.unitId,contract_id:contract.id,start_date:'2026-01-01',end_date:'2026-12-31',version:1,volume_basis:'MONTHLY',min_percent:'50',max_tolerance_percent:'40'}],operation_records:[],documents:[{id:'document',organization_id:scope.organizationId,customer_id:scope.customerId,consumer_unit_id:scope.unitId,file_verified:true,file_hash:'a'.repeat(64)}]};
  const from=(table:string)=>{let rows=[...(tables[table]??[])];const q:any={select:()=>q,is:(k:string,v:any)=>{rows=rows.filter(r=>r[k]===v);return q;},eq:(k:string,v:any)=>{rows=rows.filter(r=>r[k]===v);return q;},neq:(k:string,v:any)=>{rows=rows.filter(r=>r[k]!==v);return q;},like:(k:string,v:string)=>{rows=rows.filter(r=>String(r[k]??'').includes(v.replace(/%/g,'')));return q;},limit:async(n:number)=>({data:rows.slice(0,n),error:null}),maybeSingle:async()=>({data:rows[0]??null,error:null})};return q;};
  service=new ContractContextService({getClient:()=>({from})} as any,{requireEntitlement:jest.fn()} as any,{list:async()=>({rows:hidden?[]:tables.operation_records}),save} as any);
 });
 const capture=()=>service.capture(scope,[{month:'2026-04',predictedKwh:'150000'}],'2026-03-01T00:00:00Z',t);
 function event(mode:string,status='PUBLISHED'){
  const term={...scope,contractId:contract.id,revision:'1',sourceHash:'a'.repeat(64),source:'Synthetic source page 1',from:'2026-04-01',to:'2026-12-31',mode,confirmed:false};
  tables.operation_records.push({id:'event',organization_id:scope.organizationId,customer_id:scope.customerId,consumer_unit_id:scope.unitId,kind:'events',revision:2,status,document_id:'document',table_text:JSON.stringify({format:CONTRACT_CONTEXT_FORMAT,term,contractHash:reportHash(tables.energy_contracts[0])})});
 }
 it('uses versioned monthly billing conditions with tolerance, not a threshold heuristic',async()=>{const r=await capture();expect(r.rows[0].maximumMwh).toBe('140.000000');expect(r.rows[0].excessMwh).toBe('10.000000');expect(r.sources?.[0].revision).toBe('1');});
 it('does not inherit regular limits after a confirmed interruption',async()=>{event('INTERRUPTED');expect((await capture()).rows[0].status).toBe('NO_REGULAR_COVERAGE');});
 it('a pending interruption requires review rather than declaring old coverage',async()=>{event('INTERRUPTED','DRAFT');expect((await capture()).rows[0].status).toBe('SOURCE_PENDING');});
 it('does not silently ignore an ACL-hidden interruption or expose its source',async()=>{event('INTERRUPTED');hidden=true;const r=await capture();expect(r.rows[0].status).toBe('SOURCE_PENDING');expect(r.sources).toEqual(expect.not.arrayContaining([expect.objectContaining({mode:'INTERRUPTED'})]));});
 it('invalidates stale source documents and changed contract snapshots',async()=>{event('INTERRUPTED');tables.documents[0].file_hash='b'.repeat(64);expect((await capture()).rows[0].status).toBe('SOURCE_PENDING');tables.documents[0].file_hash='a'.repeat(64);tables.energy_contracts[0].contracted_volume_mwh='200';expect((await capture()).rows[0].status).toBe('SOURCE_PENDING');});
 it('rejects an injected organization and never writes on capture',async()=>{await expect(service.capture({...scope,organizationId:'foreign'},[],'2026-03-01',t)).rejects.toThrow();expect(save).not.toHaveBeenCalled();});
 it('returns pending when the user cannot inspect operational sources',async()=>{const result=await service.capture(scope,[{month:'2026-04',predictedKwh:'1000'}],'2026-03-01',{...t,permissions:t.permissions.filter((p:string)=>p!==P.OPERACAO_EVENTS_VIEW)});expect(result.rows[0].status).toBe('SOURCE_PENDING');});
 it('rejects unknown write fields before persisting an event',async()=>{await expect(service.save({organizationId:'foreign'},t)).rejects.toThrow();expect(save).not.toHaveBeenCalled();});
 it('uses spot billing without minimum or tolerance',async()=>{tables.supplier_billing_rules[0]={...tables.supplier_billing_rules[0],volume_basis:'SPOT',min_percent:null,max_tolerance_percent:null};const r=await capture();expect(r.rows[0].status).toBe('SPOT_PURCHASE');expect(r.rows[0].maximumMwh).toBeNull();});
});
