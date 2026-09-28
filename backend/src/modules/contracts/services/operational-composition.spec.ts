import {operationalComposition} from './operational-composition';
import {operationalTaxBases} from './operational-tax-bases';
import {taxMemory} from './tax-memory';
const unit={id:'u',organization_id:'o',customer_id:'c',free_market:true};
const month='2026-08';
function fixture(){
 const parameter=(id:string,kind:string,scenario:string)=>({id,kind,scenario,organization_id:'o',customer_id:'c',consumer_unit_id:'u',status:'APPROVED',revision:1,label:id,component_code:id,start_date:'2026-01-01',end_date:'2026-12-31',source:'Fonte '+id,base_rule:'Regra conferida',unit_context:{...unit},direction:'DEBIT',treatment:'NET',embedded_tax_codes:[],amount_text:'1',time_band:'ALL',measure:'BRL_MONTH'});
 const parameters:any[]=[parameter('tariff-acl','TARIFF','ACL'),parameter('tariff-acr','TARIFF','ACR')];
 for(const scenario of ['ACL','ACR'])for(const source of scenario==='ACL'?['SUPPLIER_ENERGY','SUPPLIER_MINIMUM','SUPPLIER_EXTRA','MONTHLY_CCEE']:['MONTHLY_CCEE'])parameters.push({...parameter(scenario+source,'COST',scenario),monetary_source:source,amount_text:null});
 for(const scenario of ['ACL','ACR'])for(const code of ['ICMS','PIS','COFINS','IOF'])parameters.push({...parameter(scenario+code,'TAX',scenario),component_code:code,measure:'PERCENT',treatment:code==='ICMS'?'OUTSIDE':'NOT_APPLICABLE',amount_text:code==='ICMS'?'10':null,tax_basis:{version:1,interaction:'INDEPENDENT',items:parameters.filter(p=>p.scenario===scenario&&p.kind!=='TAX').map(p=>({parameterId:p.id,revision:1,operation:'INCLUDE'}))}});
 const tariffs:any={measurement:{id:'m',revision:2,version:1,source:'Medição validada'},lines:parameters.filter(p=>p.kind==='TARIFF').map(p=>({parameterId:p.id,revision:1,label:p.label,scenario:p.scenario,amount:p.scenario==='ACL'?'100.00':'200.00',exactAmount:p.scenario==='ACL'?'100.000000000000000':'200.000000000000000',treatment:'NET',embeddedTaxCodes:[],source:p.source,startDate:p.start_date,endDate:p.end_date})),pending:[],warnings:[]};
 const costs:any={status:'AVAILABLE',version:{id:'costs',revision:3,version:1,validatedAt:'2026-09-01',source:'Custos validados'},blockers:[],groups:['ACL','ACR'].map(scenario=>({scenario,taxTreatment:'EXCLUDED',count:1,costs:scenario==='ACL'?'100.00':'50.00',credits:'0.00',balance:scenario==='ACL'?'100.00':'50.00',lines:[{id:'cost-'+scenario,label:'CCEE',category:'CCEE',effect:'COST',amount:scenario==='ACL'?'100.00':'50.00',signedAmount:scenario==='ACL'?'100.00':'50.00',source:'Documento conferido'}]}))};
 const supplier:any={month,status:'READY',requirements:[],contract:{id:'contract',number:'CT1'},rule:{id:'rule',version:1,source:'Regra aprovada'},measurements:{...tariffs.measurement},taxTreatment:'NET',regularAmount:'1200.00',minimumAmount:'200.00',extraAmount:'50.00',totalAmount:'1250.00',invoiceAmount:'1200.00',costVersion:costs.version,extraSources:[{id:'extra',effect:'COST',source:'Compra extra',taxTreatment:'EXCLUDED',amount:'50.00'}]};
 return {parameters,tariffs,costs,supplier};
}
function run(f:ReturnType<typeof fixture>,findings:any[]=[]){const operational=operationalTaxBases(unit,month,f.parameters,f.supplier,f.costs),taxes=taxMemory(unit,month,f.parameters,f.tariffs,operational);return operationalComposition(unit,month,f.parameters,f.tariffs,taxes,operational,f.supplier,f.costs,findings);}
const acl=(f:ReturnType<typeof fixture>)=>run(f).scenarios.find(s=>s.scenario==='ACL')!;
const blocked=(f:ReturnType<typeof fixture>)=>{expect(acl(f).status).toBe('BLOCKED');expect(acl(f).subtotal).toBeNull();expect(acl(f).supplier).toBeNull();};
describe('operational composition with real base/tax resolution',()=>{
 it('sums each component once and excludes regular NF and tax bases',()=>{const r=run(fixture());expect(r.scenarios.find(s=>s.scenario==='ACL')).toMatchObject({status:'AVAILABLE',distributor:'100.00',supplier:'1250.00',additional:'100.00',taxes:'145.00',subtotal:'1595.00'});expect(r.scenarios.find(s=>s.scenario==='ACR')).toMatchObject({status:'AVAILABLE',subtotal:'275.00',supplier:'0.00'});});
 it('ignores invoice evidence as a second expense',()=>{const f=fixture();f.supplier.invoiceAmount='1200.00';expect(acl(f).subtotal).toBe('1595.00');});
 it('uses inside tax correctly without adding the base twice',()=>{const f=fixture();f.parameters.find(p=>p.id==='ACLICMS').treatment='INSIDE';expect(acl(f).subtotal).toBe('1611.11');});
 it('retains embedded taxes without another charge',()=>{const f=fixture();for(const p of f.parameters){if(p.kind!=='TAX'){p.treatment='GROSS';p.embedded_tax_codes=['ICMS'];}else if(p.component_code==='ICMS'){p.treatment='INCLUDED';p.amount_text=null;}}for(const l of f.tariffs.lines){l.treatment='GROSS';l.embeddedTaxCodes=['ICMS'];}f.supplier.taxTreatment='GROSS';f.supplier.extraSources[0].taxTreatment='INCLUDED';f.costs.groups.forEach((g:any)=>g.taxTreatment='INCLUDED');expect(acl(f)).toMatchObject({status:'AVAILABLE',taxes:'0.00',subtotal:'1450.00'});});
 it('does not require unused zero minimum/extra origins',()=>{const f=fixture();f.supplier.minimumAmount='0.00';f.supplier.extraAmount='0.00';f.supplier.totalAmount='1200.00';f.supplier.extraSources=[];const omitted=['ACLSUPPLIER_MINIMUM','ACLSUPPLIER_EXTRA'];f.parameters=f.parameters.filter(p=>!omitted.includes(p.id));for(const p of f.parameters.filter(p=>p.kind==='TAX'))p.tax_basis.items=p.tax_basis.items.filter((i:any)=>!omitted.includes(i.parameterId));expect(acl(f).status).toBe('AVAILABLE');});
 it.each(['SUPPLIER_ENERGY','SUPPLIER_MINIMUM','SUPPLIER_EXTRA','MONTHLY_CCEE'])('requires source %s when it has a cost',source=>{const f=fixture();f.parameters=f.parameters.filter(p=>p.id!=='ACL'+source);blocked(f);});
 it('never converts missing monthly costs to zero',()=>{const f=fixture();f.costs.groups=f.costs.groups.filter((g:any)=>g.scenario!=='ACL');blocked(f);});
 it('accepts only explicit validated absence as zero',()=>{const f=fixture();f.costs.status='NO_COSTS_DECLARED';f.costs.groups=[];expect(acl(f)).toMatchObject({status:'AVAILABLE',additional:'0.00',subtotal:'1485.00'});});
 it('rejects contradictory zero declaration',()=>{const f=fixture();f.costs.status='NO_COSTS_DECLARED';blocked(f);});
 it.each(['organization_id','customer_id','consumer_unit_id'])('does not use another scope %s',key=>{const f=fixture();f.parameters.find(p=>p.id==='ACLSUPPLIER_ENERGY')[key]='other';blocked(f);});
 it('blocks draft automatic origin',()=>{const f=fixture();f.parameters.find(p=>p.id==='ACLSUPPLIER_EXTRA').status='DRAFT';blocked(f);});
 it('blocks untraced manual costs',()=>{const f=fixture();f.parameters.push({...f.parameters.find(p=>p.id==='ACLMONTHLY_CCEE'),id:'manual',monetary_source:null,amount_text:'1'});blocked(f);});
 it('blocks credits rather than taxing them as positive costs',()=>{const f=fixture();f.costs.groups[0].lines[0].effect='CREDIT';blocked(f);});
 it('blocks extra purchase credits',()=>{const f=fixture();f.supplier.extraSources[0].effect='CREDIT';blocked(f);});
 it('blocks unmatched supplier/measurement revisions',()=>{const f=fixture();f.supplier.measurements.revision=99;blocked(f);});
 it('blocks open cycle or supplier requirements',()=>{const f=fixture();f.supplier.requirements.push({message:'Ciclo aberto'});blocked(f);});
 it('blocks incomplete supplier status',()=>{const f=fixture();f.supplier.status='PENDING';blocked(f);});
 it('blocks unbalanced supplier amount',()=>{const f=fixture();f.supplier.totalAmount='999.00';blocked(f);});
 it('blocks bad additional ledger arithmetic',()=>{const f=fixture();f.costs.groups[0].costs='99.99';blocked(f);});
 it('blocks costs pending validation',()=>{const f=fixture();f.costs.status='BLOCKED';blocked(f);});
 it('blocks duplicated origin definitions',()=>{const f=fixture();f.parameters.push({...f.parameters.find(p=>p.id==='ACLSUPPLIER_EXTRA'),id:'duplicate'});blocked(f);});
 it('blocks partial source validity',()=>{const f=fixture();f.parameters.find(p=>p.id==='ACLSUPPLIER_EXTRA').start_date='2026-08-02';blocked(f);});
 it('requires classification of every component in active tax bases',()=>{const f=fixture();f.parameters.find(p=>p.id==='ACLICMS').tax_basis.items.pop();blocked(f);});
 it('keeps cadastro blockers and no available total',()=>{const r=run(fixture(),[{severity:'BLOCKER',message:'Demanda precisa revisão'}]);for(const s of r.scenarios){expect(s.subtotal).toBeNull();expect(s.blockers).toContain('Demanda precisa revisão');}});
 it('preserves source ids, revisions, deterministic order and original data',()=>{const f=fixture(),before=JSON.stringify(f),r=run(f);expect(JSON.stringify(f)).toBe(before);expect(acl(f).entries.find(e=>e.group==='SUPPLIER')).toMatchObject({revision:1,source:expect.any(String)});f.parameters.reverse();expect(run(f)).toEqual(r);});
});

describe('documental composition without duplicate parameter registration',()=>{
 function finalFixture(){const f=fixture();const omit=f.parameters.filter(p=>p.kind==='COST').map(p=>p.id);f.parameters=f.parameters.filter(p=>!omit.includes(p.id));for(const p of f.parameters.filter(p=>p.kind==='TAX'))p.tax_basis.items=p.tax_basis.items.filter((i:any)=>!omit.includes(i.parameterId));f.costs.groups.forEach((g:any)=>g.taxTreatment='INCLUDED');Object.assign(f.supplier,{formulaVersion:'spot-supplier-1.0',taxTreatment:'RESERVED',minimumAmount:'0.00',extraAmount:'0.00',totalAmount:'1200.00',taxReservation:{createdBy:'manager',reason:'Tributação não confirmada pelo fornecedor.'},reconciliation:{id:'recon',version:8,status:'APPROVED_TAX_RESERVATION',current:true,createdBy:'manager',createdAt:'2026-09-28',documentId:'doc',reason:'Conclusão autorizada com ressalva tributária documentada.'},invoiceSources:[{id:'invoice',category:'SUPPLIER_INVOICE',effect:'COST',amount:'1200.00',taxTreatment:'RESERVED',source:'NF validada'}]});return f;}
 it('includes reconciled reserved invoice and validated final costs once',()=>{const r=run(finalFixture());expect(r.scenarios.find(s=>s.scenario==='ACL')).toMatchObject({status:'AVAILABLE',supplier:'1200.00',additional:'100.00',taxes:'10.00',subtotal:'1410.00'});expect(r.scenarios.find(s=>s.scenario==='ACR')).toMatchObject({status:'AVAILABLE',subtotal:'270.00'});expect(r.qualifications).toEqual([expect.stringContaining('ressalva')]);});
 it.each(['current','createdBy','createdAt','documentId','reason'])('rejects invalid reconciliation %s',key=>{const f=finalFixture();f.supplier.reconciliation[key]=null;blocked(f);});
 it('rejects missing invoice author justification',()=>{const f=finalFixture();delete f.supplier.taxReservation.reason;blocked(f);});
 it('rejects different note total',()=>{const f=finalFixture();f.supplier.invoiceSources[0].amount='1200.01';blocked(f);});
 it('does not interpret missing additional scenario as zero',()=>{const f=finalFixture();f.costs.groups=f.costs.groups.filter((g:any)=>g.scenario==='ACL');expect(run(f).scenarios.find(s=>s.scenario==='ACR')?.status).toBe('BLOCKED');});
 it('does not infer tax exemption for NET or NOT_APPLICABLE additional costs',()=>{for(const treatment of ['EXCLUDED','NOT_APPLICABLE']){const f=finalFixture();f.costs.groups[0].taxTreatment=treatment;blocked(f);}});
 it('keeps regular supplier tax configuration mandatory',()=>{const f=finalFixture();f.supplier.taxTreatment='GROSS';blocked(f);});
 it('retains audited document references',()=>{const f=finalFixture();const s=acl(f);expect(s.entries.find(e=>e.group==='SUPPLIER')).toMatchObject({id:'document:supplier:invoice',revision:3,source:expect.stringContaining('Conciliação v8')});});

 it('adds confirmed supplier ICMS without changing or duplicating the note',()=>{const f=finalFixture(),p=f.parameters.find(p=>p.id==='ACLICMS');p.amount_text='18';const i=f.supplier.invoiceSources[0];Object.assign(f.supplier,{regularAmount:'16857.18',totalAmount:'16857.18',invoiceAmount:'16857.18'});i.amount='16857.18';i.supplierIcms={parameterId:p.id,revision:1,rate:'18',reason:'Gestor confirmou ICMS não embutido na nota do fornecedor.'};const r=acl(f);expect(r).toMatchObject({status:'AVAILABLE',supplier:'16857.18',taxes:'3718.36',subtotal:'20775.54'});expect(r.entries.filter(e=>e.label.includes('ICMS fornecedor'))).toHaveLength(1);expect(f.supplier.regularAmount).toBe('16857.18');i.supplierIcms.revision=2;blocked(f);});
 it('reconciles signed distributor adjustments and moves CIP without duplicating it',()=>{
  const f=finalFixture(),g=f.costs.groups[0],doc='doc',hash='hash',cipSource='OCR CPFL · CIP · documento '+doc+' · SHA-256 '+hash+' · cip';
  Object.assign(g.lines[0],{category:'CHARGE',source:cipSource});
  const items=[{source:'subsidy',label:'Subvenção',component:'TARIFF_SUBSIDY',effect:'COST',amount:'20.00'},{source:'refund',label:'Devolução',component:'REFUND',effect:'CREDIT',amount:'10.00'}];
  for(const i of items)g.lines.push({id:i.source,label:i.label,category:'DISTRIBUTOR_ADJUSTMENT',effect:i.effect,amount:i.amount,signedAmount:(i.effect==='CREDIT'?'-':'')+i.amount,source:'OCR CPFL · ajuste · documento '+doc+' · SHA-256 '+hash+' · '+i.source});
  Object.assign(g,{costs:'120.00',credits:'10.00',balance:'110.00',count:3});
  const evidence:any=[{documentId:doc,fileHash:hash,financial:{state:'RECONCILED',total:'210.00',tariffs:'100.00',cip:'100.00',cipSource:'cip',items,issues:[]}}];
  const calculate=()=>{const bases=operationalTaxBases(unit,month,f.parameters,f.supplier,f.costs),taxes=taxMemory(unit,month,f.parameters,f.tariffs,bases);return operationalComposition(unit,month,f.parameters,f.tariffs,taxes,bases,f.supplier,f.costs,[],evidence).scenarios.find(s=>s.scenario==='ACL')!;};
  expect(calculate()).toMatchObject({status:'AVAILABLE',distributor:'210.00',additional:'0.00',taxes:'10.00',subtotal:'1420.00',invoiceReconciliation:{total:'210.00'}});
  evidence[0].financial.total='211.00';expect(calculate()).toMatchObject({status:'BLOCKED',subtotal:null});
  evidence[0].financial.total='210.00';evidence[0].fileHash='changed';expect(calculate().status).toBe('BLOCKED');
 });
});
