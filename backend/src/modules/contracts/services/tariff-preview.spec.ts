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
 it.each(['','-1','1e3','NaN','Infinity','1,2','1.0000001','1000000000000',' 1','01',null,1])('rejects malformed decimal %s',value=>{expect(()=>tariffProduct(value as string,'1')).toThrow();expect(()=>tariffProduct('1',value as string)).toThrow();});
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
