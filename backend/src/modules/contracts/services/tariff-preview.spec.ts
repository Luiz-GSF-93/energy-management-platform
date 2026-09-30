import {prepareMeasurements} from './preparation-measurements';
import {previewTariffs,tariffProduct} from './tariff-preview';
import {normalizeMeasurements} from './monthly-inputs';
const u={id:'u',organization_id:'o',customer_id:'c',free_market:true,tariff_group:'A',tariff_modality:'GREEN',distributor:'D',state:'SP'};
const period={start:'2026-08-01',end:'2026-08-31'};
const m={id:'m',organization_id:'o',customer_id:'c',consumer_unit_id:'u',month:'2026-08',version:1,revision:2,status:'VALIDATED',validated_at:'2026-09-01',validated_by:'actor',source_reference:'Fatura conferida',unit_context:{...u},measurements:normalizeMeasurements({consumptionTotal:'1000',consumptionPeak:'100',consumptionOffPeak:'900',demandSingle:'10',reactiveTotal:'5'})};
const p={id:'p',organization_id:'o',customer_id:'c',consumer_unit_id:'u',kind:'TARIFF',component_code:'TE',label:'Energia',scenario:'ACR',time_band:'PEAK',measure:'BRL_KWH',amount_text:'0.5',direction:'DEBIT',treatment:'NET',status:'APPROVED',revision:2,source:'Resolução revisada',start_date:'2026-01-01',end_date:'2026-12-31',unit_context:{...u}};
const run=(ps:any[]=[p],ms:any[]=[m],unit:any=u)=>previewTariffs(unit,'2026-08',period,ps,ms);
function pending(r:ReturnType<typeof run>){expect(r.lines).toEqual([]);expect(r.pending.length).toBeGreaterThan(0);}
describe('exact tariff arithmetic',()=>{
 it.each([
 ['0.1','0.2',false,'0.020000000000','0.02'],
 ['1','0.005',false,'0.005000000000','0.01'],
 ['1','0.004999',false,'0.004999000000','0.00'],
 ['1000','250',true,'250.000000000000000','250.00'],
 ['0.000001','0.000001',true,'0.000000000000001','0.00'],
 ['0','0.5',false,'0.000000000000','0.00'],
 ['999999999999.999999','999999999999.999999',false,'999999999999999998000000.000000000001','999999999999999998000000.00']
 ])('multiplies %s by %s without floating point',(q,r,mwh,exact,rounded)=>expect(tariffProduct(q as string,r as string,mwh as boolean)).toEqual({exact,rounded}));
 it.each(['','-1','1e3','NaN','Infinity','1,2','1.0000000001','1000000000000',' 1','01',null,1])('rejects malformed decimal %s',value=>{expect(()=>tariffProduct(value as string,'1')).toThrow();expect(()=>tariffProduct('1',value as string)).toThrow();});
});
describe('tariff preview safety and traceability',()=>{
 it('returns formula, exact input, source and version without totals',()=>{const r=run();expect(r.lines[0]).toMatchObject({quantity:'100',rate:'0.5',amount:'50.00',exactAmount:'50.000000000000',revision:2,source:p.source,formula:'quantidade × tarifa'});expect(r.measurement).toMatchObject({id:'m',version:1,revision:2});expect(r).not.toHaveProperty('total');expect(r).not.toHaveProperty('savings');expect(r).not.toHaveProperty('ready');});
 it('converts kWh to MWh explicitly',()=>expect(run([{...p,measure:'BRL_MWH',amount_text:'250'}]).lines[0]).toMatchObject({quantity:'100',amount:'25.00',formula:'kWh × R$/MWh ÷ 1000'}));
 it('calculates reactivity only from reviewed surplus, not total energy',()=>expect(run([{...p,component_code:'REACTIVE',measure:'BRL_KVARH',time_band:'ALL'}]).lines[0]).toMatchObject({quantity:'5',quantityUnit:'kVArh',amount:'2.50'}));
 it('does not gross up NET or double tax GROSS',()=>{const r=run([{...p,treatment:'GROSS',embedded_tax_codes:['ICMS','PIS']}]);expect(r.lines[0]).toMatchObject({amount:'50.00',treatment:'GROSS',embeddedTaxCodes:['ICMS','PIS']});});
 it('handles conventional group B total',()=>{const b={...u,tariff_group:'B',tariff_modality:'CONVENTIONAL'};expect(run([{...p,time_band:'ALL',unit_context:b}],[{...m,unit_context:b}],b).lines[0].amount).toBe('500.00');});
 it.each(['organization_id','customer_id','consumer_unit_id'])('never includes foreign tariff %s',key=>expect(run([{...p,[key]:'other'}]).lines).toEqual([]));
 it.each(['organization_id','customer_id','consumer_unit_id','month'])('blocks foreign measurement %s',key=>pending(run([p],[{...m,[key]:'other'}])));
 it.each(['DRAFT','RETIRED'])('excludes %s tariff',status=>expect(run([{...p,status}]).lines).toEqual([]));
 it('excludes costs and taxes even if measure matches',()=>expect(run([{...p,kind:'COST'},{...p,kind:'TAX'}]).lines).toEqual([]));
 it('excludes tariff outside competence',()=>expect(run([{...p,start_date:'2027-01-01',end_date:'2027-12-31'}]).lines).toEqual([]));
 it.each([{start_date:'2026-08-02'},{end_date:'2026-08-30'},{end_date:'2026-02-30'},{end_date:null}])('does not prorate partial/invalid period %s',patch=>pending(run([{...p,...patch}])));
 it('does not combine competing ALL and PEAK',()=>pending(run([p,{...p,id:'all',time_band:'ALL'}])));
 it('does not combine multiple revisions for one component',()=>pending(run([p,{...p,id:'duplicate',revision:3}])));
 it('allows distinct measured peak and off peak',()=>expect(run([p,{...p,id:'off',time_band:'OFF_PEAK'}]).lines.map(l=>l.amount).sort()).toEqual(['450.00','50.00']));
 it.each([{component_code:'TUSD_DEMAND',measure:'BRL_KW'},{component_code:'OTHER_X'},{component_code:'TE',measure:'BRL_KW'},{component_code:'REACTIVE',measure:'BRL_KVARH',time_band:'PEAK'}])('does not invent formula for %s',patch=>pending(run([{...p,...patch}])));
 it('rejects unsupported white modality',()=>pending(run([p],[m],{...u,tariff_group:'B',tariff_modality:'WHITE'})));
 it('rejects total band for green',()=>pending(run([{...p,time_band:'ALL'}])));
 it('does not use measured demand as billable demand',()=>expect(run([{...p,component_code:'TUSD_DEMAND',measure:'BRL_KW'}]).pending[0].reason).toContain('demanda faturável'));
 it('blocks pending correction instead of using old data',()=>pending(run([p],[m,{...m,id:'new',version:2,status:'DRAFT'}])));
 it('requires validation evidence',()=>pending(run([p],[{...m,validated_by:null}])));
 it('blocks inconsistent sum',()=>pending(run([p],[{...m,measurements:{...m.measurements,consumptionTotal:'2000'}}])));
 it('detects stale tariff context',()=>pending(run([{...p,unit_context:{...u,state:'MG'}}])));
 it('detects stale measurement context',()=>pending(run([p],[{...m,unit_context:{...u,state:'MG'}}])));
 it.each([{amount_text:null},{amount_text:0.5},{source:''},{revision:0},{direction:'CREDIT'},{scenario:'OTHER'},{treatment:'INSIDE'},{treatment:'GROSS',embedded_tax_codes:[]}])('rejects invalid tariff fields %s',patch=>pending(run([{...p,...patch}])));
 it('accepts explicit measured zero',()=>expect(run([p],[{...m,measurements:{...m.measurements,consumptionTotal:'900',consumptionPeak:'0'}}]).lines[0].amount).toBe('0.00'));
 it('does not replace missing measurement with zero',()=>pending(run([{...p,component_code:'REACTIVE',measure:'BRL_KVARH',time_band:'ALL'}],[{...m,measurements:{...m.measurements,reactiveTotal:null}}])));
 it('does not mutate input or depend on source ordering',()=>{const off={...p,id:'off',time_band:'OFF_PEAK'},before=JSON.stringify({p,m});expect(run([p,off])).toEqual(run([off,p]));expect(JSON.stringify({p,m})).toBe(before);});
});

describe('explicit normal billed demand',()=>{
 const demand={...p,component_code:'TUSD_DEMAND',measure:'BRL_KW',time_band:'ALL',amount_text:'20'};
 const billed={...m,billed_demand:{ACR:{single:'15',peak:null,offPeak:null,source:'Regra ACR conferida'},ACL:{single:'12',peak:null,offPeak:null,source:'Fatura ACL p2'}}};
 it('uses scenario quantity, not measured demand',()=>{const r=run([demand], [billed]);expect(r.lines[0]).toMatchObject({quantity:'15',amount:'300.00',quantityUnit:'kW',quantitySource:'Regra ACR conferida',measurementKey:'billedDemand.ACR.single'});expect(run([{...demand,scenario:'ACL'}],[billed]).lines[0].amount).toBe('240.00');});
 it('never copies quantity from the other scenario',()=>pending(run([demand],[{...m,billed_demand:{ACL:billed.billed_demand.ACL}}])));
 it('accepts explicit zero',()=>expect(run([demand],[{...billed,billed_demand:{ACR:{...billed.billed_demand.ACR,single:'0'}}}]).lines[0].amount).toBe('0.00'));
 it.each([null,'','1e2','-1',15,'1.0000001'])('rejects missing or malformed quantity %s',single=>pending(run([demand],[{...billed,billed_demand:{ACR:{...billed.billed_demand.ACR,single}}}])));
 it('rejects missing evidence',()=>pending(run([demand],[{...billed,billed_demand:{ACR:{single:'15',source:''}}}])));
 it('rejects green peak tariff',()=>pending(run([{...demand,time_band:'PEAK'}],[billed])));
 it('handles blue peak and off peak independently',()=>{const blue={...u,tariff_modality:'BLUE'},bm={...m,unit_context:blue,measurements:normalizeMeasurements({...m.measurements,demandSingle:null,demandPeak:'10',demandOffPeak:'20'}),billed_demand:{ACR:{single:null,peak:'12',offPeak:'25',source:'Cenário azul'}}};const ps=[{...demand,unit_context:blue,time_band:'PEAK'},{...demand,id:'off',unit_context:blue,time_band:'OFF_PEAK'}];expect(run(ps,[bm],blue).lines.map(l=>l.amount).sort()).toEqual(['240.00','500.00']);pending(run([{...ps[0],time_band:'ALL'}],[bm],blue));pending(run(ps,[{...bm,billed_demand:{ACR:{peak:'12',source:'incompleto'}}}],blue));});
 it('does not use draft correction or foreign billed demand',()=>{pending(run([demand],[billed,{...billed,id:'v2',version:2,status:'DRAFT'}]));pending(run([demand],[{...billed,organization_id:'foreign'}]));});
 it('does not calculate overrun from normal billed quantity',()=>pending(run([{...demand,component_code:'OTHER_OVERRUN'}],[billed])));
});

describe('CDE exact invoice components',()=>{it('uses each consumption band without adding embedded taxes',()=>{const rows=[{...p,component_code:'CDE_WATER_SCARCITY',scenario:'ACL',measure:'BRL_MWH',amount_text:'5.02609',treatment:'GROSS',embedded_tax_codes:['ICMS','PIS','COFINS']},{...p,id:'off-cde',component_code:'CDE_WATER_SCARCITY',scenario:'ACL',time_band:'OFF_PEAK',measure:'BRL_MWH',amount_text:'5.02629',treatment:'GROSS',embedded_tax_codes:['ICMS','PIS','COFINS']}];const monthly={...m,measurements:normalizeMeasurements({...m.measurements,consumptionTotal:'111122.2000',consumptionPeak:'11378.6400',consumptionOffPeak:'99743.5600'})};const r=run(rows,[monthly]);expect(r.pending).toEqual([]);expect(r.lines.map(l=>l.amount).sort()).toEqual(['501.34','57.19']);expect(r.lines.every(l=>l.embeddedTaxCodes.length===3)).toBe(true);});});


describe('validated consumption previews with missing measured demand',()=>{
 const missing={...m,measurements:{...m.measurements,demandSingle:null,demandPeak:null,demandOffPeak:null}};
 const parameters=[{...p,id:'tusd-peak',component_code:'TUSD_ENERGY',scenario:'ACL',measure:'BRL_MWH',amount_text:'981.92227',treatment:'GROSS',embedded_tax_codes:['ICMS','PIS','COFINS']},{...p,id:'tusd-off',component_code:'TUSD_ENERGY',scenario:'ACL',time_band:'OFF_PEAK',measure:'BRL_MWH',amount_text:'212.65684',treatment:'GROSS',embedded_tax_codes:['ICMS','PIS','COFINS']},{...p,id:'cde-peak',component_code:'CDE_WATER_SCARCITY',scenario:'ACL',measure:'BRL_MWH',amount_text:'5.02609',treatment:'GROSS',embedded_tax_codes:['ICMS','PIS','COFINS']},{...p,id:'cde-off',component_code:'CDE_WATER_SCARCITY',scenario:'ACL',time_band:'OFF_PEAK',measure:'BRL_MWH',amount_text:'5.02629',treatment:'GROSS',embedded_tax_codes:['ICMS','PIS','COFINS']}];
 it('calculates the four invoice energy components, preserves evidence and flags partial scope',()=>{const source={...missing,measurements:{...missing.measurements,consumptionTotal:'111122.2000',consumptionPeak:'11378.6400',consumptionOffPeak:'99743.5600'}},before=JSON.stringify(source),r=run(parameters,[source]);expect(prepareMeasurements(u,'2026-08',[source]).findings).toEqual(expect.arrayContaining([expect.objectContaining({code:'MEASUREMENTS_DEMAND',severity:'BLOCKER'})]));expect(r.formulaVersion).toBe('tariffs-1.4');expect(r.pending).toEqual([]);expect(Object.fromEntries(r.lines.map(l=>[l.parameterId,l.amount]))).toEqual({'tusd-peak':'11172.94','tusd-off':'21211.15','cde-peak':'57.19','cde-off':'501.34'});expect(r.measurement).toMatchObject({id:'m',revision:2,source:'Fatura conferida'});expect(r.warnings.some(w=>w.includes('demanda medida continua pendente'))).toBe(true);expect(JSON.stringify(source)).toBe(before);expect(r).not.toHaveProperty('total');expect(r).not.toHaveProperty('savings');});
 it('allows valid TE energy preview but keeps demand and reactive previews blocked',()=>{const r=run([p,{...p,id:'demand',component_code:'TUSD_DEMAND',measure:'BRL_KW',time_band:'ALL'},{...p,id:'reactive',component_code:'REACTIVE',measure:'BRL_KVARH',time_band:'ALL'}],[{...missing,billed_demand:{ACR:{single:'500',peak:null,offPeak:null,source:'Fatura'}}}]);expect(r.lines.map(l=>l.parameterId)).toEqual(['p']);expect(r.pending.map(l=>l.parameterId)).toEqual(['demand','reactive']);});
 it('also handles blue modality missing measured demand without inferring it',()=>{const blue={...u,tariff_modality:'BLUE'};expect(run([{...p,unit_context:blue}],[{...missing,unit_context:blue}],blue).lines[0].amount).toBe('50.00');});
 it.each([{validated_by:null},{source_reference:''},{validated_at:null},{unit_context:{...u,state:'MG'}},{version:0},{status:'DRAFT'}])('still blocks invalid monthly evidence %p',patch=>pending(run(parameters,[{...missing,...patch}])));
 it('still blocks new draft corrections and duplicate version histories',()=>{pending(run(parameters,[missing,{...missing,id:'next',version:2,status:'DRAFT'}]));pending(run(parameters,[missing,{...missing,id:'duplicate'}]));});
 it.each([{consumptionTotal:'2000'},{consumptionPeak:null},{consumptionOffPeak:'-1'},{demandSingle:'invalid'},{demandSingle:'10',demandPeak:'12'}])('does not bypass malformed/inconsistent values %p',patch=>pending(run(parameters,[{...missing,measurements:{...missing.measurements,...patch}}])));
 it('does not emit partial warnings for complete valid measurements',()=>expect(run(parameters).warnings.some(w=>w.startsWith('Prévia parcial'))).toBe(false));
});

describe('exact split ACL demand',()=>{
 const used={...p,id:'used',scenario:'ACL',component_code:'TUSD_DEMAND_USED',time_band:'ALL',measure:'BRL_KW',amount_text:'10.70900103',treatment:'GROSS',embedded_tax_codes:['ICMS','PIS','COFINS']};
 const unused={...used,id:'unused',component_code:'TUSD_DEMAND_UNUSED',amount_text:'8.78135364',embedded_tax_codes:['PIS','COFINS']};
 const monthly={...m,measurements:{...m.measurements,demandSingle:null},billed_demand:{ACL:{single:'500',used:'234.6400',unused:'265.3600',source:'Fatura p1, parcelas conferidas'}}};
 it('preserves invoice precision and does not add embedded taxes',()=>{const r=run([used,unused],[monthly]);expect(r.pending).toEqual([]);expect(r.lines.map(l=>l.amount).sort()).toEqual(['2330.22','2512.76']);expect(r.lines.find(l=>l.component==='TUSD_DEMAND_USED')).toMatchObject({rate:'10.70900103',quantity:'234.6400',measurementKey:'billedDemand.ACL.used'});expect(r.warnings.join(' ')).toContain('impede o fechamento');expect(monthly.measurements.demandSingle).toBeNull();});
 it('rejects simultaneous aggregate and split demand',()=>pending(run([used,unused,{...used,id:'total',component_code:'TUSD_DEMAND'}],[monthly])));
 it('requires both approved tariffs',()=>pending(run([used],[monthly])));
 it.each([{single:'499'},{unused:null},{used:'234.0000001'},{source:''}])('rejects inconsistent split %s',patch=>pending(run([used,unused],[{...monthly,billed_demand:{ACL:{...monthly.billed_demand.ACL,...patch}}}])));
 it('never infers a missing split from total or measured demand',()=>pending(run([used,unused],[{...monthly,billed_demand:{ACL:{single:'500',source:'Somente total'}}}])));
 it('rejects ten decimal places',()=>{const r=run([{...used,amount_text:'10.7090010301'},unused],[monthly]);expect(r.lines.some(l=>l.parameterId==='used')).toBe(false);});
 it('does not allow extra precision in energy tariff',()=>pending(run([{...p,amount_text:'0.12345678'}],[m])));
 it('rounds nine decimal rates half up',()=>expect(tariffProduct('1','0.005000000').rounded).toBe('0.01'));
 it('keeps quantities limited to six decimals',()=>expect(()=>tariffProduct('1.0000001','1')).toThrow());
});

describe('ACR split reference demand',()=>{
 const used={...p,id:'acr-used',scenario:'ACR',component_code:'TUSD_DEMAND_USED',time_band:'ALL',measure:'BRL_KW',amount_text:'20',treatment:'GROSS',embedded_tax_codes:['ICMS','PIS','COFINS']};
 const unused={...used,id:'acr-unused',component_code:'TUSD_DEMAND_UNUSED',amount_text:'16',embedded_tax_codes:['PIS','COFINS']};
 const d={single:'500',used:'234.6400',unused:'265.3600',source:'ACR mesmas condições de demanda, tarifas de referência próprias'};
 const monthly={...m,billed_demand:{ACR:d,ACL:{...d,source:'Fatura ACL'}}};
 it('uses independent ACR rates and preserves per-line tax treatment',()=>{const r=run([used,unused,{...used,id:'acl-used',scenario:'ACL',amount_text:'10.70900103'},{...unused,id:'acl-unused',scenario:'ACL',amount_text:'8.78135364'}],[monthly]);expect(r.pending).toEqual([]);expect(r.lines.filter(l=>l.scenario==='ACR').map(l=>l.amount).sort()).toEqual(['4245.76','4692.80']);expect(r.lines.filter(l=>l.scenario==='ACL').map(l=>l.amount).sort()).toEqual(['2330.22','2512.76']);expect(r.lines.find(l=>l.parameterId==='acr-unused')).toMatchObject({measurementKey:'billedDemand.ACR.unused',quantity:'265.3600',embeddedTaxCodes:['PIS','COFINS'],quantitySource:d.source});});
 it('does not infer ACR quantities from ACL alone',()=>pending(run([used,unused],[{...m,billed_demand:{ACL:d}}])));
 it('does not copy ACL tariff when ACR counterpart is missing',()=>pending(run([used,{...unused,scenario:'ACL'}],[monthly])));
 it('does not double count total with ACR split',()=>pending(run([used,unused,{...used,id:'aggregate',component_code:'TUSD_DEMAND'}],[monthly])));
 it('blocks both ACR parcels if one rate is invalid',()=>pending(run([used,{...unused,amount_text:'invalid'}],[monthly])));
 it('blocks unvalidated source revisions',()=>pending(run([used,unused],[{...monthly,status:'DRAFT'}])));
 it('keeps exact zero unused as zero',()=>{const r=run([used,unused],[{...monthly,billed_demand:{ACR:{...d,single:'234.6400',unused:'0'}}}]);expect(r.pending).toEqual([]);expect(r.lines.find(l=>l.parameterId==='acr-unused')?.amount).toBe('0.00');});
});

describe('F1.118 reactive billing and explicit tariff flag',()=>{
 const measured={...m,measurements:normalizeMeasurements({consumptionTotal:'111122.2000',consumptionPeak:'11378.6400',consumptionOffPeak:'99743.5600',demandSingle:'235',reactiveBilledPeakKwh:'0.9716',reactiveBilledOffPeakKwh:'121.4116'})};
 const peak={...p,component_code:'REACTIVE',measure:'BRL_MWH',amount_text:'360.23055'},off={...peak,id:'off',time_band:'OFF_PEAK',amount_text:'375.99373'};
 it('uses billed reactive quantities in both scenarios with exact conversion',()=>{const r=run([peak,off,{...peak,id:'acl',scenario:'ACL'}],[measured]);expect(r.lines.map(l=>l.amount).sort()).toEqual(['0.35','0.35','45.65']);expect(r.lines.every(l=>l.quantityUnit==='kWh')).toBe(true);expect(r.lines.find(l=>l.parameterId==='off')).toMatchObject({measurementKey:'reactiveBilledOffPeakKwh',quantity:'121.4116'});});
 it('uses registered ACR kWh rate without replacing its value',()=>expect(run([{...peak,measure:'BRL_KWH',amount_text:'0.360230'}],[measured]).lines[0]).toMatchObject({rate:'0.360230',amount:'0.35'}));
 it.each([{}, {reactiveBilledPeakKwh:'0.9716',reactiveBilledOffPeakKwh:'121.4116',reactiveTotal:'1'}])('rejects missing or mixed reactive units',patch=>pending(run([peak],[{...measured,measurements:{...m.measurements,reactiveTotal:null,...patch}}])));
 it('accepts explicit zero instead of absent value',()=>expect(run([peak],[{...measured,measurements:{...measured.measurements,reactiveBilledPeakKwh:'0'}}]).lines[0].amount).toBe('0.00'));
 it('keeps legacy kVArh and new kWh distinct',()=>pending(run([{...peak,measure:'BRL_KVARH',time_band:'ALL'}],[measured])));
 it('calculates typed flags with consumption and never infers formula from label',()=>{const r=run([{...p,component_code:'TARIFF_FLAG',amount_text:'0.024414'},{...p,id:'custom',component_code:'OTHER',label:'Bandeira Tarifária'}],[measured]);expect(r.lines).toHaveLength(1);expect(r.lines[0]).toMatchObject({measurementKey:'consumptionPeak',quantity:'11378.6400',amount:'277.80'});expect(r.pending[0].parameterId).toBe('custom');});
});

describe('Elektro reactive charge in one documented band',()=>{
 it('calculates only the documented off-peak band in ACL and ACR without manufacturing peak zero',()=>{const input={...m,measurements:normalizeMeasurements({...m.measurements,reactiveTotal:null,reactiveBilledOffPeakKwh:'39'})};const tariff={...p,component_code:'REACTIVE',time_band:'OFF_PEAK',measure:'BRL_MWH',amount_text:'403.59'};const result=run([tariff,{...tariff,id:'acl',scenario:'ACL'},{...tariff,id:'missing-peak',time_band:'PEAK'}],[input]);expect(result.lines.map(l=>l.amount)).toEqual(['15.74','15.74']);expect(result.pending.some(l=>l.parameterId==='missing-peak')).toBe(true);expect(input.measurements).not.toHaveProperty('reactiveBilledPeakKwh');});
});
