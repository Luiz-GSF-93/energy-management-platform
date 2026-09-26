import {previewTariffs} from './tariff-preview';
import {taxMemory} from './tax-memory';
import {distributorSubtotal} from './distributor-subtotal';
import {normalizeMeasurements} from './monthly-inputs';
const unit={id:'u',organization_id:'o',customer_id:'c',free_market:true,tariff_group:'A',tariff_modality:'GREEN',distributor:'D',state:'SP'};
const base={organization_id:'o',customer_id:'c',consumer_unit_id:'u',status:'APPROVED',revision:2,scenario:'ACR',start_date:'2026-01-01',end_date:'2026-12-31',unit_context:{...unit},direction:'DEBIT',source:'Fonte aprovada'};
function fixture(){
 const tariff:any={...base,id:'energy',kind:'TARIFF',component_code:'TE',label:'Energia bruta',time_band:'PEAK',measure:'BRL_KWH',amount_text:'1.234567',treatment:'GROSS',embedded_tax_codes:['ICMS','PIS','COFINS']};
 const taxes:any[]=['ICMS','PIS','COFINS','IOF'].map(code=>({...base,id:code,kind:'TAX',component_code:code,label:code,time_band:'ALL',measure:'PERCENT',amount_text:null,treatment:code==='IOF'?'NOT_APPLICABLE':'INCLUDED',base_rule:'Regra aprovada',tax_basis:code==='IOF'?null:{version:1,items:[{parameterId:'energy',revision:2,operation:'INCLUDE'}]}}));
 const measurement:any={id:'m',organization_id:'o',customer_id:'c',consumer_unit_id:'u',month:'2026-08',version:1,revision:2,status:'VALIDATED',validated_at:'2026-09-01',validated_by:'actor',source_reference:'Fatura',unit_context:{...unit},measurements:normalizeMeasurements({consumptionTotal:'1000',consumptionPeak:'100',consumptionOffPeak:'900',demandSingle:'10',reactiveTotal:'5'})};
 return {parameters:[tariff,...taxes],measurements:[measurement]};
}
function run(f=fixture()){
 const preview=previewTariffs(unit,'2026-08',{start:'2026-08-01',end:'2026-08-31'},f.parameters,f.measurements),tax=taxMemory(unit,'2026-08',f.parameters,preview),subtotal=distributorSubtotal(unit,'2026-08',f.parameters,preview,tax).scenarios[0];return {preview,tax,subtotal};
}
const blocked=(f:ReturnType<typeof fixture>)=>{const r=run(f);expect(r.subtotal.status).toBe('BLOCKED');expect(r.subtotal.subtotal).toBeNull();};
describe('approved included taxes through actual memories',()=>{
 it('uses the gross tariff once without extracting tax or asserting exemption',()=>{const r=run();expect(r.tax.pending).toEqual([]);expect(r.tax.lines).toEqual([]);expect(r.tax.declarations.filter(d=>d.treatment==='INCLUDED')).toHaveLength(3);expect(r.tax.declarations[0]).toMatchObject({revision:2,references:[{id:'energy',revision:2,operation:'INCLUDE',exactAmount:null}]});expect(r.subtotal).toMatchObject({status:'AVAILABLE',tariffs:'123.46',taxes:'0.00',subtotal:'123.46',embeddedTaxCodes:['COFINS','ICMS','PIS']});expect(r.subtotal.entries).toHaveLength(1);expect(r.subtotal.entries[0].treatment).toBe('GROSS');});
 it('accepts an informational rate without computing it again',()=>{const f=fixture();f.parameters[1].amount_text='18';expect(run(f).subtotal.subtotal).toBe('123.46');});
 it('does not infer the other scenario',()=>{const f=fixture(),r=run(f);expect(distributorSubtotal(unit,'2026-08',f.parameters,r.preview,r.tax).scenarios[1].subtotal).toBeNull();});
 it.each(['organization_id','customer_id','consumer_unit_id'])('rejects a foreign base %s',key=>{const f=fixture();f.parameters[0][key]='other';blocked(f);});
 it.each(['organization_id','customer_id','consumer_unit_id'])('rejects a foreign declaration %s',key=>{const f=fixture();f.parameters[1][key]='other';blocked(f);});
 it.each(['EXEMPT','NOT_APPLICABLE','INSIDE','OUTSIDE'])('blocks conflicting %s treatment of an embedded code',treatment=>{const f=fixture();f.parameters[1].treatment=treatment;f.parameters[1].amount_text=['INSIDE','OUTSIDE'].includes(treatment)?'18':null;blocked(f);});
 it.each(['101','-1','1e2','NaN','0.1234567',18])('rejects invalid informational rate %s',amount=>{const f=fixture();f.parameters[1].amount_text=amount;blocked(f);});
 it.each([null,{version:1,items:[]},{version:1,items:[null]},{version:2,items:[{parameterId:'energy',revision:2,operation:'INCLUDE'}]}])('rejects incomplete basis %j',basis=>{const f=fixture();f.parameters[1].tax_basis=basis;blocked(f);});
 it('rejects duplicate references',()=>{const f=fixture();f.parameters[1].tax_basis.items.push({...f.parameters[1].tax_basis.items[0]});blocked(f);});
 it('rejects stale references',()=>{const f=fixture();f.parameters[0].revision=3;blocked(f);});
 it('rejects draft correction',()=>{const f=fixture();f.parameters.push({...f.parameters[1],id:'draft',status:'DRAFT'});blocked(f);});
 it('rejects duplicate declarations for a code',()=>{const f=fixture();f.parameters.push({...f.parameters[1],id:'duplicate'});blocked(f);});
 it('requires validated measurements',()=>{const f=fixture();f.measurements[0].status='DRAFT';blocked(f);});
 it('blocks partially covered month',()=>{const f=fixture();f.parameters[1].start_date='2026-08-02';blocked(f);});
 it('requires reference to cover full declaration validity',()=>{const f=fixture();f.parameters[0].start_date='2026-08-01';blocked(f);});
 it('requires matching electrical context',()=>{const f=fixture();f.parameters[1].unit_context={...unit,state:'RJ'};blocked(f);});
 it.each(['SEQUENTIAL','SHARED_INSIDE'])('rejects recalculation interaction %s',interaction=>{const f=fixture();f.parameters[1].tax_basis.interaction=interaction;blocked(f);});
 it('rejects hidden predecessor taxes even in independent mode',()=>{const f=fixture();f.parameters[1].tax_basis.taxes=[{parameterId:'PIS',revision:2}];blocked(f);});
 it('rejects hidden shared group',()=>{const f=fixture();f.parameters[1].tax_basis.groupCodes=['ICMS','PIS'];blocked(f);});
 it('requires an included custom embedded code to be configured',()=>{const f=fixture();f.parameters[0].embedded_tax_codes.push('OTHER_CUSTOM');blocked(f);});
 it('rejects malformed embedded code',()=>{const f=fixture();f.parameters[0].embedded_tax_codes.push('INVALID');blocked(f);});
 it('rejects duplicate embedded code',()=>{const f=fixture();f.parameters[0].embedded_tax_codes.push('ICMS');blocked(f);});
 it('does not treat net tariff as gross',()=>{const f=fixture();f.parameters[0].treatment='NET';blocked(f);});
 it('blocks excluded rubrics that actually embed this code',()=>{const f=fixture();f.parameters[1].tax_basis.items[0].operation='EXCLUDE';blocked(f);});
 it('requires every tariff classified without inventing base inclusion',()=>{const f=fixture();f.parameters.push({...f.parameters[0],id:'second',component_code:'TUSD_ENERGY'});blocked(f);});
 it('combines gross and net prices only with explicit separate bases',()=>{
  const f=fixture();f.parameters[0].embedded_tax_codes=['ICMS'];
  const net={...f.parameters[0],id:'net',label:'Tarifa líquida',component_code:'TUSD_ENERGY',treatment:'NET',embedded_tax_codes:[],amount_text:'1'};f.parameters.push(net);
  f.parameters[1].tax_basis.items.push({parameterId:'net',revision:2,operation:'EXCLUDE'});
  for(const t of f.parameters.filter(p=>['PIS','COFINS'].includes(p.id))){t.treatment='OUTSIDE';t.amount_text='1';t.tax_basis={version:1,interaction:'INDEPENDENT',items:[{parameterId:'energy',revision:2,operation:'EXCLUDE'},{parameterId:'net',revision:2,operation:'INCLUDE'}]};}
  expect(run(f).subtotal).toMatchObject({status:'AVAILABLE',tariffs:'223.46',taxes:'2.00',subtotal:'225.46',embeddedTaxCodes:['ICMS']});
 });
 it('validates gross-memory codes against approved registration',()=>{const f=fixture(),r=run(f);r.preview.lines[0].embeddedTaxCodes=['ICMS'];expect(distributorSubtotal(unit,'2026-08',f.parameters,r.preview,r.tax).scenarios[0].status).toBe('BLOCKED');});
 it('rejects a stale included declaration independently of upstream validation',()=>{const f=fixture(),r=run(f);r.tax.declarations[0].revision=1;expect(distributorSubtotal(unit,'2026-08',f.parameters,r.preview,r.tax).scenarios[0].status).toBe('BLOCKED');});
 it('does not mutate approved input and is deterministic',()=>{const f=fixture(),before=JSON.stringify(f),r=run(f);expect(JSON.stringify(f)).toBe(before);expect(run(f)).toEqual(r);});
});
