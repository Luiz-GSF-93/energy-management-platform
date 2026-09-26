import {distributorSubtotal} from './distributor-subtotal';
const unit={id:'u',organization_id:'org',customer_id:'c'};
const parameter=(id:string,kind='TARIFF',scenario='ACR')=>({id,organization_id:'org',customer_id:'c',consumer_unit_id:'u',kind,scenario,status:'APPROVED',revision:1,label:id,start_date:'2026-01-01',end_date:'2026-12-31',treatment:kind==='TARIFF'?'NET':'EXEMPT',component_code:id});
function fixture(){
 const parameters=[parameter('energy'),...['ICMS','PIS','COFINS','IOF'].map(c=>parameter(c,'TAX'))];
 const tariff:any={measurement:{id:'m',revision:1},lines:[{parameterId:'energy',revision:1,label:'Energia',scenario:'ACR',amount:'100.01',treatment:'NET',embeddedTaxCodes:[],source:'Fatura'}],pending:[]};
 const tax:any={lines:[],declarations:['ICMS','PIS','COFINS','IOF'].map(id=>({id,label:id,scenario:'ACR',treatment:'EXEMPT',source:'Fonte aprovada'})),pending:[]};
 return {parameters,tariff,tax};
}
const run=(f:ReturnType<typeof fixture>)=>distributorSubtotal(unit,'2026-10',f.parameters,f.tariff,f.tax);
const first=(f:ReturnType<typeof fixture>)=>run(f).scenarios[0];
const blocked=(f:ReturnType<typeof fixture>)=>{const s=first(f);expect(s.status).toBe('BLOCKED');expect(s.subtotal).toBeNull();expect(s.tariffs).toBeNull();expect(s.taxes).toBeNull();};
function addTax(f:ReturnType<typeof fixture>,amount='18.00'){
 f.parameters.find(p=>p.id==='ICMS')!.treatment='INSIDE';f.tax.declarations=f.tax.declarations.filter((d:any)=>d.id!=='ICMS');
 f.tax.lines.push({id:'ICMS',revision:1,label:'ICMS',scenario:'ACR',treatment:'INSIDE',amount,source:'Regra aprovada',references:[{id:'energy',revision:1,operation:'INCLUDE'}],base:'100.01',taxReferences:[{amount:'999.00'}]});
}
describe('distributor component consolidation',()=>{
 it('sums explicit reviewed entries without inventing the other scenario',()=>{const f=fixture(),r=run(f);expect(r.scenarios[0].subtotal).toBe('100.01');expect(r.scenarios[0].taxes).toBe('0.00');expect(r.scenarios[1].subtotal).toBeNull();expect(r.scenarios[0].entries[0]).toMatchObject({id:'energy',revision:1,source:'Fatura'});});
 it('adds each tax once, never its base or referenced taxes',()=>{const f=fixture();addTax(f);expect(first(f)).toMatchObject({subtotal:'118.01',tariffs:'100.01',taxes:'18.00'});});
 it('sums cent amounts exactly at arbitrary precision',()=>{const f=fixture();f.tariff.lines[0].amount='99999999999999999999.99';addTax(f,'0.02');expect(first(f).subtotal).toBe('100000000000000000000.01');});
 it('keeps a legitimate zero and the rounding contract explicit',()=>{const f=fixture();f.tariff.lines[0].amount='0.00';expect(first(f).subtotal).toBe('0.00');expect(run(f).rounding).toBe('SUM_ROUNDED_LINES');});
 it.each(['ICMS','PIS','COFINS','IOF'])('requires an explicit treatment of %s',code=>{const f=fixture();f.parameters=f.parameters.filter(p=>p.id!==code);f.tax.declarations=f.tax.declarations.filter((d:any)=>d.id!==code);blocked(f);});
 it.each(['1.001','NaN','-1.00','1e3','','01.00'])('rejects invalid money %s',amount=>{const f=fixture();f.tariff.lines[0].amount=amount;blocked(f);});
 it('blocks pending tariff even if a stale value exists',()=>{const f=fixture();f.tariff.pending.push({parameterId:'energy',scenario:'ACR',label:'Energia',reason:'Corrigir demanda'});blocked(f);});
 it('blocks pending tax even if a stale value exists',()=>{const f=fixture();addTax(f);f.tax.pending.push({id:'ICMS',scenario:'ACR',label:'ICMS',reason:'Revisar interação'});blocked(f);});
 it('blocks tax-included tariffs rather than adding again',()=>{const f=fixture();f.tariff.lines[0].treatment='GROSS';blocked(f);});
 it('blocks embedded tax codes even on a net line',()=>{const f=fixture();f.tariff.lines[0].embeddedTaxCodes=['ICMS'];blocked(f);});
 it('requires classification of every tariff',()=>{const f=fixture();addTax(f);f.tax.lines[0].references=[];blocked(f);});
 it('does not subtract excluded references again',()=>{const f=fixture();addTax(f);f.tax.lines[0].references[0].operation='EXCLUDE';expect(first(f).subtotal).toBe('118.01');});
 it('rejects a reference to a different revision',()=>{const f=fixture();addTax(f);f.tax.lines[0].references[0].revision=2;blocked(f);});
 it('rejects references outside consolidated tariffs',()=>{const f=fixture();addTax(f);f.tax.lines[0].references.push({id:'foreign',revision:1,operation:'INCLUDE'});blocked(f);});
 it('rejects ambiguous or duplicated memory values',()=>{const f=fixture();f.tariff.lines.push({...f.tariff.lines[0]});blocked(f);});
 it('rejects duplicated declarations',()=>{const f=fixture();f.tax.declarations.push({...f.tax.declarations[0]});blocked(f);});
 it('blocks partial validity',()=>{const f=fixture();f.parameters[0].start_date='2026-10-02';blocked(f);});
 it('blocks invalid calendar dates',()=>{const f=fixture();f.parameters[0].start_date='2026-02-31';blocked(f);});
 it('blocks drafts in the same scenario and period',()=>{const f=fixture();f.parameters.push({...parameter('draft'),status:'DRAFT'});blocked(f);});
 it('ignores historical drafts outside the month',()=>{const f=fixture();f.parameters.push({...parameter('old'),status:'DRAFT',end_date:'2026-09-30'});expect(first(f).status).toBe('AVAILABLE');});
 it.each(['organization_id','customer_id','consumer_unit_id'] as const)('never incorporates foreign %s parameters',key=>{const f=fixture();f.parameters[0][key]='foreign';blocked(f);});
 it('ignores unrelated tenant drafts',()=>{const f=fixture();f.parameters.push({...parameter('draft'),organization_id:'other',status:'DRAFT'});expect(first(f).status).toBe('AVAILABLE');});
 it('requires validated measurement identity',()=>{const f=fixture();f.tariff.measurement=null;blocked(f);});
 it('requires source text',()=>{const f=fixture();f.tariff.lines[0].source=' ';blocked(f);});
 it('rejects incompatible exemption declaration',()=>{const f=fixture();f.tax.declarations[0].treatment='OUTSIDE';blocked(f);});
 it('preserves input and deterministic order',()=>{const f=fixture(),before=JSON.stringify(f),a=run(f);expect(JSON.stringify(f)).toBe(before);f.parameters.reverse();expect(run(f)).toEqual(a);});
});

// Integration with actual upstream memories, including exact inside-tax arithmetic.
import {previewTariffs} from './tariff-preview';
import {taxMemory} from './tax-memory';
import {normalizeMeasurements} from './monthly-inputs';
describe('subtotal through actual tariff and tax memories',()=>{
 it.each(['single','shared'])('consolidates %s inside configuration once',mode=>{
  const u={...unit,free_market:true,tariff_group:'A',tariff_modality:'GREEN',distributor:'D',state:'SP'};
  const m={id:'m',organization_id:'org',customer_id:'c',consumer_unit_id:'u',month:'2026-10',version:1,revision:2,status:'VALIDATED',validated_at:'2026-11-01',validated_by:'actor',source_reference:'Fatura',unit_context:{...u},measurements:normalizeMeasurements({consumptionTotal:'1000',consumptionPeak:'100',consumptionOffPeak:'900',demandSingle:'10',reactiveTotal:'5'})};
  const tariff={...parameter('energy'),component_code:'TE',time_band:'PEAK',measure:'BRL_KWH',amount_text:'1',direction:'DEBIT',source:'Tarifa',unit_context:{...u}};
  const taxes=['ICMS','PIS','COFINS','IOF'].map(code=>({...parameter(code,'TAX'),time_band:'ALL',measure:'PERCENT',amount_text:null as string|null,direction:'DEBIT',source:'Fonte tributária',base_rule:'Regra explícita',unit_context:{...u},tax_basis:null as any}));
  taxes[0].treatment='INSIDE';taxes[0].amount_text=mode==='single'?'20':'18';taxes[0].tax_basis={version:1,interaction:mode==='single'?'INDEPENDENT':'SHARED_INSIDE',items:[{parameterId:'energy',revision:1,operation:'INCLUDE'}]};
  if(mode==='shared'){taxes[0].tax_basis.groupCodes=['ICMS','PIS'];taxes[1].treatment='INSIDE';taxes[1].amount_text='2';taxes[1].tax_basis={...taxes[0].tax_basis};}
  const parameters=[tariff,...taxes],preview=previewTariffs(u,'2026-10',{start:'2026-10-01',end:'2026-10-31'},parameters,[m]),memory=taxMemory(u,'2026-10',parameters,preview);
  expect(preview.pending).toEqual([]);expect(memory.pending).toEqual([]);
  const result=distributorSubtotal(u,'2026-10',parameters,preview,memory).scenarios[0];expect(result.blockers).toEqual([]);expect(result).toMatchObject({tariffs:'100.00',taxes:'25.00',subtotal:'125.00'});
 });
});
