import {invoiceComparison,modelConfidence,tariffCandidates,tariffMatrix} from './eva-tariff-workbench.model';
import {extractCpflPaulistaLayout} from './cpfl-paulista-layout';
jest.mock('./cpfl-paulista-layout',()=>({extractCpflPaulistaLayout:jest.fn()}));
const extractor=extractCpflPaulistaLayout as jest.Mock;
const field=(decimal:string,confidence:number|null=0.95)=>({decimal,text:decimal,confidence,issues:[],pages:[1]});
function fixture(){
 const op=(component:string,amount:string)=>({component,role:'CHARGE',source:component,fields:{amount:field(amount),description:{...field(component)},quantity:field('100'),aneelRate:field('1'),unit:{text:'kWh'},icmsAmount:field('10.00'),pisAmount:field('1.00'),cofinsAmount:field('4.00')},issues:[]});
 const layout:any={layoutId:'synthetic',reconciliation:{state:'MATCH'},fields:['customerTaxId','unit','reference','classification'].map(name=>({name,source:name,value:field('1')})),operations:[op('TUSD_ENERGY','150.00'),{...op('OTHER','20.00'),fields:{amount:field('20.00'),description:field('CIP')}}]};extractor.mockReturnValue(layout);
 const c:any={unit:{id:'unit',organization_id:'org',distributor:'Teste',tariff_group:'B',tariff_subgroup:'B3',tariff_modality:'CONVENTIONAL',consumption_class:'GENERAL'},month:'2026-09',document:{id:'doc',file_hash:'a'.repeat(64)},source:{raw:{}}};
 const lib:any={id:'lib',organization_id:'org',version:1,profile:{distributor:'Teste',group:'B',subgroup:'B3',modality:'CONVENTIONAL',consumptionClass:'GENERAL',startDate:'2026-01-01',endDate:'2026-12-31',source:'Referência sintética',taxTreatment:'NET',items:[{component:'TE',band:'ALL',measure:'BRL_KWH',value:'1',label:'TE'},{component:'TUSD_ENERGY',band:'ALL',measure:'BRL_KWH',value:'0.5',label:'TUSD'}]}};
 const p:any={fields:[{key:'consumptionTotal',state:'FILLED',value:'100'}],operational:{invoice:{amount:'170.00'}}};return {c,p,lib,layout};
}
describe('Tariff comparison and model qualification',()=>{
 it('conserves original taxes and other charges once',()=>{const x=fixture(),r=invoiceComparison(x.c,x.p,[x.lib]);expect(r.amount).toBe('185.00');expect(r.retained.map(x=>x.amount)).toEqual(['15.00','20.00']);expect(r.method).toBe('SAME_INVOICE_QUANTITIES_AND_CHARGES_V1')});
 it('does not add original taxes to a gross/unknown tariff',()=>{for(const treatment of ['GROSS',undefined]){const x=fixture();x.lib.profile.taxTreatment=treatment;expect(invoiceComparison(x.c,x.p,[x.lib]).amount).toBeNull()}});
 it('does not balance unexplained differences as invented expense',()=>{const x=fixture();x.p.operational.invoice.amount='171.00';expect(invoiceComparison(x.c,x.p,[x.lib]).amount).toBeNull()});
 it('requires each essential tax cell, not a blank assumed zero',()=>{const x=fixture();delete x.layout.operations[0].fields.pisAmount;expect(invoiceComparison(x.c,x.p,[x.lib]).missing.join()).toContain('decomposição')});
 it('does not use tariffs from another organization',()=>{const x=fixture();x.lib.organization_id='other';expect(invoiceComparison(x.c,x.p,[x.lib]).library).toBeNull()});
 it('requires the complete tariff period and detects ambiguity',()=>{const x=fixture();expect(invoiceComparison(x.c,x.p,[x.lib,{...x.lib,id:'other'}]).amount).toBeNull();x.lib.profile.startDate='2026-09-02';expect(invoiceComparison(x.c,x.p,[x.lib]).amount).toBeNull()});
 it('does not create an absent reactive tariff',()=>{const x=fixture();x.p.fields.push({key:'reactiveTotal',state:'FILLED',value:'10'});expect(invoiceComparison(x.c,x.p,[x.lib]).amount).toBeNull()});
 it('requires mandatory TE and TUSD lines',()=>{const x=fixture();x.lib.profile.items.pop();expect(invoiceComparison(x.c,x.p,[x.lib]).amount).toBeNull()});
 it('uses a measured demand only as an explicit comparative hypothesis',()=>{const x=fixture();Object.assign(x.c.unit,{tariff_group:'A',tariff_subgroup:'A4',tariff_modality:'GREEN'});Object.assign(x.lib.profile,{group:'A',subgroup:'A4',modality:'GREEN'});x.lib.profile.items=tariffMatrix('A','GREEN').filter(i=>i.component!=='REACTIVE').map(i=>({...i,value:'1',label:i.component}));x.p.fields=[{key:'consumptionPeak',state:'FILLED',value:'10'},{key:'consumptionOffPeak',state:'FILLED',value:'90'},{key:'demandSingle',state:'FILLED',value:'5'}];const r=invoiceComparison(x.c,x.p,[x.lib]);expect(r.amount).toBe('240.00');expect(r.observations.join()).toContain('medida utilizada como hipótese')});
 it('scores the minimum instead of hiding one poor field in a high average',()=>{const x=fixture();x.layout.fields[0].value.confidence=0.7;expect(modelConfidence({})).toMatchObject({score:0.7,state:'NEEDS_REVISION',threshold:0.9})});
 it('does not promote confidence after a manual confirmation or missing provider score',()=>{const x=fixture();x.layout.fields[0].value.confidence=null;expect(modelConfidence({}).score).toBeNull()});
 it('requires consistency even above the threshold',()=>{const x=fixture();x.layout.reconciliation.state='DIFFERENCE';expect(modelConfidence({}).state).toBe('NEEDS_REVISION')});
 it('supports a stricter threshold while preserving the same observed score',()=>{fixture();expect(modelConfidence({},0.98)).toMatchObject({score:0.95,state:'NEEDS_REVISION',threshold:0.98})});
 it('keeps registration suggestions distinct from OCR confidence',()=>{const x=fixture();expect(tariffCandidates(x.c).candidates[0]).toMatchObject({origin:'REGISTRATION',confidence:null})});
 it('represents conventional, blue and white profiles without inventing inapplicable posts',()=>{expect(tariffMatrix('B','CONVENTIONAL').every(i=>i.band==='ALL')).toBe(true);expect(tariffMatrix('B','WHITE').filter(i=>i.band==='INTERMEDIATE')).toHaveLength(2);expect(tariffMatrix('A','BLUE').filter(i=>i.component==='TUSD_DEMAND_USED').map(i=>i.band)).toEqual(['PEAK','OFF_PEAK'])});
});
