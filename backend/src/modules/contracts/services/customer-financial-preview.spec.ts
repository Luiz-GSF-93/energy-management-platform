import {customerFinancialPreview,CustomerUnitInput} from './customer-financial-preview';
import {feeCents} from './management-fee';
const month='2026-08';
const contract={id:'contract',organization_id:'o',customer_id:'c',status:'ACTIVE',start_date:'2026-01-01',end_date:'2026-12-31',contract_number:'H1',remuneration_model:'HYBRID',fixed_fee_monthly:'1000.00',savings_percentage:'20'};
function fixture(){const units=['a','b'].map(id=>({id,name:'Unidade '+id,organization_id:'o',customer_id:'c'}));const inputs:CustomerUnitInput[]=units.map(u=>({unitId:u.id,month,checkedAt:'2026-09-01T12:00:00Z',composition:{formulaVersion:'operational-composition-1.0',rounding:'SUM_ROUNDED_LINES',warnings:[],scenarios:(['ACR','ACL'] as const).map(scenario=>{const amount=scenario==='ACR'?'10000.00':'5000.00';return {scenario,status:'AVAILABLE',distributor:amount,supplier:'0.00',additional:'0.00',taxes:'0.00',subtotal:amount,entries:[{id:u.id+'tariff'+scenario,revision:2,label:'Tarifa',group:'DISTRIBUTOR',amount,source:'Fonte revisada'}],blockers:[]};})}}));return {units,inputs,contracts:[{...contract}],rules:[{id:'rule',organization_id:'o',customer_id:'c',contract_id:'contract',month,version:1,fixed_fee_basis:'PER_UNIT',source:'Regra mensal',allocations:[{consumerUnitId:'a',percentage:'25'},{consumerUnitId:'b',percentage:'75'}]}]};}
const run=(f:ReturnType<typeof fixture>)=>customerFinancialPreview('o','c',month,f.units,f.inputs,f.contracts,f.rules);
function change(f:ReturnType<typeof fixture>,unit:number,scenario:'ACL'|'ACR',value:string){const s=f.inputs[unit].composition.scenarios.find(s=>s.scenario===scenario)!;s.subtotal=value;s.distributor=value;s.entries[0].amount=value;}
function blocked(f:ReturnType<typeof fixture>){const r=run(f);expect(r.status).toBe('BLOCKED');expect(r.acr).toBeNull();expect(r.totalFees).toBeNull();expect(r.savingsAfterFees).toBeNull();expect(r.units.every(u=>u.totalFees===null)).toBe(true);}
describe('customer preliminary consolidation and fees',()=>{
 it('charges fixed per unit, percentage on consolidated economy before fixed, allocates only variable',()=>{const r=run(fixture());expect(r).toMatchObject({status:'AVAILABLE',acr:'20000.00',aclBeforeFees:'10000.00',savingsBeforeFees:'10000.00',fixedFee:'2000.00',variableFee:'2000.00',totalFees:'4000.00',aclAfterFees:'14000.00',savingsAfterFees:'6000.00',savingsPercent:'30.00'});expect(r.units[0]).toMatchObject({fixedFee:'1000.00',variableFee:'500.00',totalFees:'1500.00'});expect(r.units[1]).toMatchObject({fixedFee:'1000.00',variableFee:'1500.00',totalFees:'2500.00'});});
 it('matches confirmed single-unit example: 10000 savings, 1000 fixed, 20% = 3000',()=>{const f=fixture();f.units=f.units.slice(0,1);f.inputs=f.inputs.slice(0,1);change(f,0,'ACR','20000.00');change(f,0,'ACL','10000.00');f.rules[0].allocations=[{consumerUnitId:'a',percentage:'100'}];expect(run(f).totalFees).toBe('3000.00');});
 it('offsets a losing unit against a gaining unit before applying the percentage',()=>{const f=fixture();change(f,0,'ACL','12000.00');change(f,1,'ACL','5000.00');expect(run(f)).toMatchObject({savingsBeforeFees:'3000.00',variableFee:'600.00',savingsAfterFees:'400.00'});});
 it('keeps negative economy, floors only variable at zero',()=>{const f=fixture();change(f,0,'ACL','20000.00');expect(run(f)).toMatchObject({savingsBeforeFees:'-5000.00',variableFee:'0.00',fixedFee:'2000.00',savingsAfterFees:'-7000.00',savingsPercent:'-35.00'});});
 it('keeps full fixed charge at zero variable allocation',()=>{const f=fixture();f.rules[0].allocations=[{consumerUnitId:'a',percentage:'0'},{consumerUnitId:'b',percentage:'100'}];expect(run(f).units[0]).toMatchObject({variableFee:'0.00',fixedFee:'1000.00',totalFees:'1000.00'});});
 it('preserves every residual cent when variable is divided',()=>{const f=fixture();f.contracts[0].fixed_fee_monthly='0';f.contracts[0].savings_percentage='100';change(f,0,'ACR','5000.01');change(f,1,'ACR','5000.00');f.rules[0].allocations=[{consumerUnitId:'b',percentage:'50'},{consumerUnitId:'a',percentage:'50'}];const r=run(f);expect(r.variableFee).toBe('0.01');expect(r.units[0].variableFee).toBe('0.01');expect(r.units[1].variableFee).toBe('0.00');expect(r.units.reduce((n,u)=>n+feeCents(u.totalFees),0n)).toBe(feeCents(r.totalFees));});
 it('uses half-up once for the customer variable amount',()=>{const f=fixture();f.contracts[0].savings_percentage='50';change(f,0,'ACR','5000.01');change(f,1,'ACR','5000.00');expect(run(f).variableFee).toBe('0.01');});
 it('does not divide by zero ACR',()=>{const f=fixture();change(f,0,'ACR','0.00');change(f,1,'ACR','0.00');expect(run(f)).toMatchObject({status:'AVAILABLE',savingsPercent:null,variableFee:'0.00'});});
 it('supports fixed-only with no allocation and full fixed per unit',()=>{const f=fixture();f.contracts[0].remuneration_model='FIXED';f.contracts[0].savings_percentage='0';f.rules[0].allocations=[];expect(run(f)).toMatchObject({totalFees:'2000.00',variableFee:'0.00'});});
 it('blocks any missing unit result',()=>{const f=fixture();f.inputs.pop();blocked(f);});
 it('blocks duplicate result instead of hiding missing unit',()=>{const f=fixture();f.inputs[1]=f.inputs[0];blocked(f);});
 it('blocks different month',()=>{const f=fixture();f.inputs[0].month='2026-07';blocked(f);});
 it.each(['organization_id','customer_id'])('rejects foreign unit %s',key=>{const f=fixture();(f.units[0] as any)[key]='other';blocked(f);});
 it('blocks empty customer scope',()=>{const f=fixture();f.units=[];f.inputs=[];blocked(f);});
 it('blocks one pending scenario without exposing partial totals',()=>{const f=fixture();f.inputs[0].composition.scenarios[0].status='BLOCKED';f.inputs[0].composition.scenarios[0].blockers=['Tributo pendente'];blocked(f);expect(run(f).units[0].blockers.join('')).toContain('Tributo pendente');});
 it('blocks forged subtotal',()=>{const f=fixture();f.inputs[0].composition.scenarios[0].subtotal='1.00';blocked(f);});
 it('blocks missing entry provenance',()=>{const f=fixture();f.inputs[0].composition.scenarios[0].entries[0].source='';blocked(f);});
 it('blocks duplicated money entries',()=>{const f=fixture();const s=f.inputs[0].composition.scenarios[0];s.entries.push(s.entries[0]);blocked(f);});
 it('blocks omitted variable unit',()=>{const f=fixture();f.rules[0].allocations=[{consumerUnitId:'a',percentage:'100'}];blocked(f);});
 it('blocks foreign variable unit and invalid total',()=>{const f=fixture();f.rules[0].allocations[1].consumerUnitId='foreign';blocked(f);f.rules[0].allocations[1].consumerUnitId='b';f.rules[0].allocations[1].percentage='70';blocked(f);});
 it.each(['organization_id','customer_id','contract_id','month'])('ignores foreign rule %s',key=>{const f=fixture();(f.rules[0] as any)[key]='other';blocked(f);});
 it('blocks competing contracts',()=>{const f=fixture();f.contracts.push({...f.contracts[0],id:'other'});blocked(f);});
 it('blocks partial/invalid contract dates',()=>{const f=fixture();f.contracts[0].start_date='2026-08-02';blocked(f);f.contracts[0].start_date='2026-02-31';blocked(f);});
 it.each(['NaN','-1','101','1e2','0.0000001'])('blocks malformed contract percentage %s',value=>{const f=fixture();f.contracts[0].savings_percentage=value;blocked(f);});
 it('rejects fixed customer allocation legacy',()=>{const f=fixture();f.rules[0].fixed_fee_basis='CUSTOMER';blocked(f);});
 it('uses latest rule immutably and preserves sources',()=>{const f=fixture();f.rules.push({...f.rules[0],id:'rule2',version:2,source:'Correção aprovada'});const before=JSON.stringify(f),r=run(f);expect(r.allocation).toMatchObject({id:'rule2',version:2,source:'Correção aprovada'});expect(r.units[0].references[0].revision).toBe(2);expect(JSON.stringify(f)).toBe(before);});
 it('blocks duplicated latest version',()=>{const f=fixture();f.rules.push({...f.rules[0],id:'rule2'});blocked(f);});
 it('stable allocation and ordering regardless of database row order',()=>{const f=fixture(),r=run(f);f.units.reverse();f.inputs.reverse();f.rules[0].allocations.reverse();expect(run(f)).toEqual(r);});
});

it('preserves documentary tax reservations in consolidated preview',()=>{const f=fixture();f.inputs[0].composition.qualifications=['Tributos não confirmados: revisão necessária.'];expect(run(f).warnings).toContain('Tributos não confirmados: revisão necessária.');expect(run(f).status).toBe('AVAILABLE');});

describe('legacy SQL contract date compatibility',()=>{
 it.each(['T00:00:00','T00:00:00.000','T00:00:00Z','T00:00:00+00:00'])('accepts midnight %s without rewriting sources',suffix=>{const f=fixture();f.contracts[0].start_date='2023-05-17'+suffix;f.contracts[0].end_date='2026-12-31'+suffix;const before=JSON.stringify(f);expect(run(f)).toMatchObject({status:'AVAILABLE',totalFees:'4000.00'});expect(JSON.stringify(f)).toBe(before);});
 it.each(['2026-08-02T00:00:00','2026-02-30T00:00:00','2026-08-01T12:30:00','2026-08-01T00:00:00-03:00'])('keeps invalid or partial date blocked: %s',date=>{const f=fixture();f.contracts[0].start_date=date;blocked(f);});

 it('recalculates the reconciled CPFL/Axia sample and management fees, preserving signed credits',()=>{
  const f=fixture();f.units=f.units.slice(0,1);f.inputs=f.inputs.slice(0,1);f.rules[0].allocations=[{consumerUnitId:'a',percentage:'100'}];f.contracts[0].fixed_fee_monthly='1302.05';f.contracts[0].savings_percentage='9.8';const c=f.inputs[0].composition;c.formulaVersion='operational-composition-1.1';
  const entry=(id:string,group:'DISTRIBUTOR'|'SUPPLIER'|'ADDITIONAL'|'TAX',amount:string)=>({id,group,amount,revision:1,label:id,source:'Documento conferido '+id});
  Object.assign(c.scenarios[0],{distributor:'95193.90',supplier:'0.00',additional:'137.58',taxes:'0.00',subtotal:'95331.48',entries:[entry('acr','DISTRIBUTOR','95193.90'),entry('cip-acr','ADDITIONAL','137.58')]});
  Object.assign(c.scenarios[1],{distributor:'40583.96',supplier:'16857.18',additional:'0.00',taxes:'3700.36',subtotal:'61141.50',invoiceReconciliation:{documentId:'invoice',fileHash:'hash',total:'40583.96',status:'RECONCILED'},entries:[entry('tariffs','DISTRIBUTOR','37831.60'),entry('subsidy-tax','DISTRIBUTOR','11261.11'),entry('subsidy','DISTRIBUTOR','2329.22'),entry('subsidy-credit','DISTRIBUTOR','-10885.72'),entry('refund','DISTRIBUTOR','-89.83'),entry('cip','DISTRIBUTOR','137.58'),entry('axia','SUPPLIER','16857.18'),entry('icms-axia','TAX','3700.36')]});
  expect(run(f)).toMatchObject({status:'AVAILABLE',acr:'95331.48',aclBeforeFees:'61141.50',savingsBeforeFees:'34189.98',fixedFee:'1302.05',variableFee:'3350.62',totalFees:'4652.67',aclAfterFees:'65794.17',savingsAfterFees:'29537.31',savingsPercent:'30.98'});
  delete c.scenarios[1].invoiceReconciliation;blocked(f);
 });
});
