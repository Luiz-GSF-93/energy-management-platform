import {demandLineClassification as classify,demandTaxEvidence} from './demand-line-classification';
const row=(text:string):any=>({fields:{description:{text,issues:[]}},issues:[]});
describe('Explicit demand usage labels',()=>{
 it.each(['Uso Sist. Distr. Demanda Utilizada','DEMANDA UTILIZADA PONTA','Demanda utilizada fora ponta'])('recognizes literal used label %s',text=>expect(classify(row(text)).kind).toBe('USED_EXPLICIT'));
 it.each(['Uso Sist. Distr. Demanda não utilizada','DEMANDA NAO UTILIZADA','Demanda não-utilizada'])('recognizes literal unused label %s',text=>expect(classify(row(text)).kind).toBe('UNUSED_EXPLICIT'));
 it.each(['Uso Sist. Distr. 49,99 Desc AGO/26','Demanda contratada','Demanda medida','Demanda ultrapassagem','Demanda utilizada e demanda não utilizada','Sem demanda utilizada','Não demanda utilizada',''])('preserves ambiguity for %s',text=>expect(classify(row(text)).kind).toBe('UNCLASSIFIED'));
 it('rejects unverified description',()=>{const r=row('Demanda utilizada');r.fields.description.issues=['UNVERIFIED_SOURCE'];expect(classify(r).kind).toBe('UNCLASSIFIED');});
 it('rejects merged source',()=>{const r=row('Demanda não utilizada');r.issues=['MERGED_OR_DUPLICATE_CELL'];expect(classify(r).kind).toBe('UNCLASSIFIED');});
 it('does not infer from values or taxes',()=>{const r=row('Uso Sist. Distr.');r.fields.quantity={decimal:'265.3600'};r.fields.icmsRate={decimal:'0'};expect(classify(r).kind).toBe('UNCLASSIFIED');});
});

describe('Explicit zero tax evidence',()=>{
 const make=(source:string,amount='0'):any=>({source,component:'DEMAND_BILLED',role:'CHARGE',issues:[],fields:{description:{text:'Uso Sist. Distr.',issues:[]},unit:{text:'kW',issues:[]},...Object.fromEntries(['icmsAmount','pisAmount','cofinsAmount'].map(k=>[k,{text:amount,decimal:amount,issues:[]}]))}});
 it('flags explicit zero ICMS with positive PIS and Cofins as review only',()=>{const r=make('a','1');r.fields.icmsAmount={text:'0',decimal:'0',issues:[]};expect(demandTaxEvidence(r,[r,make('b','1.25')])).toMatchObject({kind:'UNUSED_TAX_REVIEW',basis:'ZERO_ICMS_WITH_PIS_COFINS'});});
 it.each(['icmsAmount','pisAmount','cofinsAmount'])('does not interpret missing %s as zero',k=>{const r=make('a','1');r.fields.icmsAmount={text:'0',decimal:'0',issues:[]};delete r.fields[k];expect(demandTaxEvidence(r,[r,make('b','1')])).toBeNull();});
 it.each([{text:'',decimal:'0',issues:[]},{text:'-',decimal:null,issues:[]},{text:'0',decimal:'0',issues:['UNVERIFIED_SOURCE']},{text:'abc',decimal:null,issues:[]}])('rejects unread or ambiguous value %p',field=>{const r=make('a','1');r.fields.icmsAmount={text:'0',decimal:'0',issues:[]};r.fields.pisAmount=field;expect(demandTaxEvidence(r,[r,make('b','1')])).toBeNull();});
 it('does not infer from all-exempt or multiple counterparts',()=>{const r=make('a','1');r.fields.icmsAmount={text:'0',decimal:'0',issues:[]};expect(demandTaxEvidence(r,[r,make('b')])).toBeNull();expect(demandTaxEvidence(r,[r,make('b','1'),make('c','2')])).toBeNull();});
 it('rejects mixed taxes and different component',()=>{const r=make('a','1');r.fields.icmsAmount={text:'0',decimal:'0',issues:[]};r.fields.icmsAmount=make('b','1').fields.icmsAmount;expect(demandTaxEvidence(r,[r,make('b','1')])).toBeNull();const a=make('a'),b=make('b','1');b.component='TUSD_ENERGY';expect(demandTaxEvidence(a,[a,b])).toBeNull();});
});

describe('Corrected tax pattern excludes all-zero taxes',()=>{it('does not flag a fully zero-tax line',()=>{const row=(source:string,v:string):any=>({source,component:'DEMAND_BILLED',role:'CHARGE',issues:[],fields:{unit:{text:'kW'},...Object.fromEntries(['icmsAmount','pisAmount','cofinsAmount'].map(k=>[k,{text:v,decimal:v,issues:[]}]))}});const a=row('a','0');expect(demandTaxEvidence(a,[a,row('b','1')])).toBeNull();});});
