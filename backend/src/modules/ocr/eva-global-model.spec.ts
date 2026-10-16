import {globalFieldEvidence,globalModelConfidence,globalPreparationEvidence,verifiedGlobalPreparation} from './eva-global-model';
import {extractCpflPaulistaLayout} from './cpfl-paulista-layout';
jest.mock('./cpfl-paulista-layout',()=>({extractCpflPaulistaLayout:jest.fn()}));
function fixture(){
 const raw:any={content:'',stringIndexType:'utf16CodeUnit',pages:[{pageNumber:1,words:[]}]};
 const field=(text:string,confidence:any=0.99)=>{const offset=raw.content.length;raw.content+=text+' ';raw.pages[0].words.push({content:text,confidence:0.98,span:{offset,length:text.length}});return {text,decimal:/^\d+(\.\d+)?$/.test(text)?text:null,confidence,pages:[1],spans:[{offset,length:text.length}],issues:confidence===null?['MISSING_CONFIDENCE']:[]};};
 const layout:any={layoutId:'test',reconciliation:{state:'MATCH'},fields:['customerTaxId','unit','reference','classification'].map(name=>({name,source:name,value:field(name==='classification'?'A4_VERDE':'123')})),operations:[]};
 layout.fields[3].value=field('A4 VERDE');raw.pages[0].words=raw.pages[0].words.filter((w:any)=>!w.content.includes(' '));
 const op:any={source:'table.0',role:'CHARGE',component:'TE',issues:[],arithmetic:{state:'MATCH'},fields:{description:field('Energia'),quantity:field('100'),unit:field('kWh'),aneelRate:field('0.5'),amount:field('50.00'),icmsAmount:field('5.00')}};
 layout.operations=[op,{source:'total',role:'TOTAL',fields:{amount:field('50.00')},issues:[]}];
 (extractCpflPaulistaLayout as jest.Mock).mockReturnValue(layout);
 return {raw,layout,field,op};
}
describe('Global model quality V2',()=>{
 it('allows a section below 90 when the global score and coverage are sufficient',()=>{const x=fixture();x.layout.fields[3].value.confidence=0.8;const result=globalModelConfidence(x.raw);expect(result.score).toBeGreaterThan(0.9);expect(result.sections[1].score).toBe(0.8);expect(result).toMatchObject({state:'READY_FOR_REVIEW',complete:true,version:2})});
 it('derives confidence from completely verified words without altering native evidence',()=>{const x=fixture(),f=x.field('1234',null);expect(globalFieldEvidence(x.raw,f)).toMatchObject({method:'VERIFIED_WORDS_WEIGHTED',confidence:0.98,filled:true});expect(f.confidence).toBeNull()});
 it('does not turn a missing value into zero or a high-confidence result',()=>{const x=fixture();x.op.fields.quantity=null;const result=globalModelConfidence(x.raw);expect(result.complete).toBe(false);expect(result.state).toBe('NEEDS_REVISION')});
 it('does not omit unscored evidence from coverage',()=>{const x=fixture();x.op.fields.amount.confidence=null;x.raw.pages[0].words=[];const r=globalModelConfidence(x.raw);expect(r.confidenceCoverage).toBeLessThan(1);expect(r.sections[4].score).toBeLessThan(0.99)});
 it('rejects conflicting identity/profile and unexplained totals regardless of average',()=>{const x=fixture();expect(globalModelConfidence(x.raw,0.9,{tariff_subgroup:'A40',tariff_modality:'GREEN'}).state).toBe('NEEDS_REVISION');x.layout.reconciliation.state='DIFFERENCE';expect(globalModelConfidence(x.raw).consistent).toBe(false)});
 it('does not treat native confidence as evidence when its source span differs',()=>{const x=fixture(),f=x.field('99');f.text='98';expect(globalFieldEvidence(x.raw,f)).toMatchObject({filled:false,confidence:null})});
 it('rejects partial word coverage and page mismatch',()=>{const x=fixture(),f=x.field('1234',null);x.raw.pages[0].words.at(-1).span.length=3;expect(globalFieldEvidence(x.raw,f).confidence).toBeNull();f.pages=[2];expect(globalFieldEvidence(x.raw,f).filled).toBe(false)});
 it('does not weight duplicate projections twice',()=>{const x=fixture();x.layout.operations.push({...x.op});expect(globalModelConfidence(x.raw).sections[3].fields).toHaveLength(2)});
 it('accepts repeated identical identity evidence without counting it as a missing field',()=>{const x=fixture();x.layout.fields.push({...x.layout.fields[1]});expect(globalModelConfidence(x.raw).complete).toBe(true)});
 it('does not choose an identity from conflicting repeated evidence',()=>{const x=fixture();x.layout.fields.push({name:'unit',source:'other',value:x.field('999')});expect(globalModelConfidence(x.raw).complete).toBe(false)});
 it('does not declare a truncated preparation complete',()=>{const x=fixture();for(let i=0;i<40;i++)x.layout.operations.push({...x.op,source:'row.'+i});expect(globalModelConfidence(x.raw)).toMatchObject({truncated:true,complete:false,state:'NEEDS_REVISION',completion:null})});
 it('validates every generated field against its exact field key, value and source',()=>{const x=fixture(),e=globalPreparationEvidence(globalModelConfidence(x.raw));const valid={key:e[0].fieldKey,value:e[0].value,evidenceId:e[0].id};const r=verifiedGlobalPreparation(e,{state:'READY',fields:[valid,{...valid,value:'999999'},{...valid,key:'other.customer'}]});expect(r.rejected).toBe(2);expect(r.fields[0].origin).toBe('OCR_AI_VERIFIED');expect(r.fields.some(f=>f.value==='999999')).toBe(false);expect(r.automaticFinancialApproval).toBe(false)});
 it('preserves deterministic mapped values even if AI is unavailable',()=>{const x=fixture(),e=globalPreparationEvidence(globalModelConfidence(x.raw));expect(verifiedGlobalPreparation(e,{state:'FAILED',fields:[]}).fields).toHaveLength(e.length)});
});
