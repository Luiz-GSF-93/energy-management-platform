import {energyPriceDashboard} from './energy-price-dashboard';
import {reviewDigest} from '../contracts/services/review-snapshots.service';
const units=[{id:'u1',name:'Unit 1',customerId:'c1',customerName:'Client'},{id:'u2',name:'Unit 2',customerId:'c1',customerName:'Client'}];
const baseline={state:'AVAILABLE',submarket:'SE_CO',annualKwh:'12000',annualGrossTe:'7200.00',annualNetTe:'3600.00',contractNetBrlMwh:'225.50'};
function source(){const preparations=Object.fromEntries(units.map((u,i)=>[u.id,{measurements:{validatedVersion:{measurements:{consumptionPeak:'100',consumptionOffPeak:'900',consumptionTotal:'1000'}}},contractSupplierCost:{status:'READY',month:'2026-01',requirements:[],taxTreatment:'GROSS',totalAmount:i?'400.00':'200.00'},operationalComposition:{scenarios:[{scenario:'ACL',status:'AVAILABLE',supplier:i?'400.00':'200.00'}]}}]));const payload={sources:{organizationId:'o1',customerId:'c1',month:'2026-01'},financial:{status:'AVAILABLE',units},preparations};return {units,customerId:'c1',studies:[],baselines:units.map(u=>({unitId:u.id,payload:baseline})),financial:units.map(u=>({unitId:u.id,month:'2026-01',payload,hash:reviewDigest(payload)})),pld:[{month:'2026-01',submarket:'SE_CO',value:'180.123456'}],canPublish:false};}
describe('scoped price dashboard',()=>{
 it('weights all units, calculates score and leaves missing months empty',()=>{const d=energyPriceDashboard('o1',2026,source(),true);expect(d.acrAverage).toBe('600.00');expect(d.aclAverage).toBe('300.00');expect(d.months[0]).toMatchObject({acl:'300.00',pld:'180.12',scorePercent:'50.00'});expect(d.months[1].acl).toBeNull();expect(d.indicative.value).toBe('225.50');expect(d.indicative.reason).toContain('não compra realizada');});
 it('keeps market spread separate from supplier cost and does not fill missing months',()=>{
 const s=source(),d=energyPriceDashboard('o1',2026,s,true);
 expect(d.months[0]).toMatchObject({acl:'300.00',pld:'180.12',pldSpread5:'189.13',pldSpread10:'198.14',pldSpread15:'207.14'});
 expect(d.months[1]).toMatchObject({pld:null,pldSpread5:null,pldSpread10:null,pldSpread15:null});
 s.pld=[];expect(energyPriceDashboard('o1',2026,s,true).months[0]).toMatchObject({acl:'300.00',pldSpread15:null});
 });
 it('uses the month and submarket and weights different submarkets by consumption',()=>{
 const s:any=source();s.baselines[1].payload={...baseline,submarket:'S'};
 s.pld=[{month:'2026-01',submarket:'SE_CO',value:'100'},{month:'2026-01',submarket:'S',value:'300'}];
 expect(energyPriceDashboard('o1',2026,s,true).months[0]).toMatchObject({pld:'200.00',pldSpread5:'210.00',pldSpread10:'220.00',pldSpread15:'230.00'});
 s.pld[1].month='2026-02';
 expect(energyPriceDashboard('o1',2026,s,true).months[0]).toMatchObject({pld:null,pldSpread15:null});
 });
 it('excludes distributor, demand and management amounts from the ACL profile',()=>{
 const s:any=source();for(const f of s.financial){for(const p of Object.values(f.payload.preparations) as any[]){Object.assign(p.operationalComposition.scenarios[0],{distributor:'99999.00',demand:'50000.00',fees:'12000.00'});}f.hash=reviewDigest(f.payload);}
 expect(energyPriceDashboard('o1',2026,s,true).aclAverage).toBe('300.00');
 });
 it('does not consolidate partial unit coverage',()=>{const s=source();s.financial.pop();const d=energyPriceDashboard('o1',2026,s,true);expect(d.aclAverage).toBeNull();expect(d.months[0].acl).toBeNull();});
 it('rejects cross-client, altered hashes and draft studies in client view',()=>{const s=source();s.units=[{...units[0],customerId:'c2'}];expect(()=>energyPriceDashboard('o1',2026,s,true)).toThrow('outro cliente');const x=source();x.financial[0].hash='f'.repeat(64);expect(()=>energyPriceDashboard('o1',2026,x,true)).toThrow('Integridade');const y:any=source();y.studies=[{body:{}}];expect(()=>energyPriceDashboard('o1',2026,y,true)).toThrow('escopo');});
 it('uses explicit supplier-only tax amounts for net contracts',()=>{const s:any=source();s.units=s.units.slice(0,1);s.baselines=s.baselines.slice(0,1);s.financial=s.financial.slice(0,1);const p=s.financial[0].payload,prep=p.preparations.u1;prep.contractSupplierCost.taxTreatment='NET';prep.operationalTaxBases={lines:[{scenario:'ACL',monetarySource:'SUPPLIER_ENERGY',parameterId:'base'}]};prep.taxMemory={pending:[],lines:[{id:'tax',scenario:'ACL',amount:'43.90',references:[{id:'base'}]}]};prep.operationalComposition.scenarios[0].entries=[{id:'tax',group:'TAX',amount:'43.90'}];s.financial[0].hash=reviewDigest(p);let d=energyPriceDashboard('o1',2026,s,true);expect(d.aclAverage).toBe('243.90');expect(d.indicative.value).toBe('200.00');prep.taxMemory.lines[0].references.push({id:'distributor'});s.financial[0].hash=reviewDigest(p);expect(energyPriceDashboard('o1',2026,s,true).aclAverage).toBeNull();});
 it('never exposes an unpublished baseline to the Portal',()=>{const s=source();s.baselines=[];const d=energyPriceDashboard('o1',2026,s,true);expect(d.acrAverage).toBeNull();expect(d.indicative.value).toBeNull();});
});
