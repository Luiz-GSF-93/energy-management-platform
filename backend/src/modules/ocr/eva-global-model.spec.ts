import {globalFieldEvidence,globalModelConfidence,globalPreparationEvidence,verifiedGlobalPreparation,globalModelLayout,globalAdviceEvidence} from './eva-global-model';
import {extractCpflPaulistaLayout} from './cpfl-paulista-layout';
import {validateInterpretation} from './azure-backoffice-ai.connector';
jest.mock('./cpfl-paulista-layout',()=>({extractCpflPaulistaLayout:jest.fn()}));
function fixture(){
 const raw:any={content:'',stringIndexType:'utf16CodeUnit',pages:[{pageNumber:1,words:[]}]};
 const field=(text:string,confidence:any=0.99)=>{const offset=raw.content.length;raw.content+=text+' ';raw.pages[0].words.push({content:text,confidence:0.98,span:{offset,length:text.length}});return {text,decimal:/^-?\d+(\.\d+)?$/.test(text)?text:null,confidence,pages:[1],spans:[{offset,length:text.length}],issues:confidence===null?['MISSING_CONFIDENCE']:[]};};
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
 it.each(['1.23','-1.23'])('recognizes only scoped monetary correction, preserving amount/sign %s',amount=>{const x=fixture();const row={source:'correction',component:'OTHER',role:'UNKNOWN',issues:['UNMAPPED_COMPONENT'],fields:{description:x.field('Atualização Monetária AGO/26'),amount:x.field(amount)},arithmetic:{state:'NOT_VERIFIABLE'}};x.layout.operations.push(row);const r=globalModelLayout(x.raw).operations.at(-1)!;expect(r.component).toBe('MONETARY_CORRECTION');expect(r.fields.amount.decimal).toBe(amount);expect(r.role).toBe(amount.startsWith('-')?'CREDIT':'CHARGE');expect(row.role).toBe('UNKNOWN');expect(row.issues).toContain('UNMAPPED_COMPONENT');});
 it('does not whitelist another unknown charge or an unverified correction',()=>{const x=fixture(),row:any={source:'unknown',component:'OTHER',role:'UNKNOWN',issues:['UNMAPPED_COMPONENT'],fields:{description:x.field('Outra despesa não classificada'),amount:x.field('1.23')},arithmetic:{state:'NOT_VERIFIABLE'}};x.layout.operations.push(row);expect(globalModelConfidence(x.raw).consistent).toBe(false);expect(globalModelConfidence(x.raw).reviewReasons).toEqual(expect.arrayContaining([expect.objectContaining({label:'Outra despesa não classificada'})]));row.fields.description=x.field('Atualização Monetária AGO/26');row.fields.amount.issues=['UNVERIFIED_SOURCE'];expect(globalModelLayout(x.raw).operations.at(-1)?.role).toBe('UNKNOWN');});
 it('keeps a high confidence from masking a divergent total even with a recognized correction',()=>{const x=fixture();x.layout.reconciliation.state='DIVERGENT';expect(globalModelConfidence(x.raw).state).toBe('NEEDS_REVISION')});
 it('uses one bounded summary with formatted numbers and no field-copy instructions',()=>{const x=fixture(),r=globalModelConfidence(x.raw),e=globalAdviceEvidence(r);expect(e).toHaveLength(1);expect(e[0].fieldKey).toBeUndefined();expect(JSON.parse(e[0].value).confidence).toBe('99.0%');expect(JSON.stringify(e)).not.toContain('spans');expect(Buffer.byteLength(JSON.stringify(e))).toBeLessThan(6000)});
 it('keeps 84 prepared fields out of the generation request and grounds formatted percentages',()=>{const x=fixture(),r=globalModelConfidence(x.raw);r.score=0.986;r.fields=Array.from({length:84},(_,i)=>({...r.fields[0],key:'field-'+i,value:'PRIVATE_FACT_NOT_NEEDED'}));const e=globalAdviceEvidence(r);expect(JSON.parse(e[0].value).preparedFields).toBe(84);expect(JSON.stringify(e)).not.toContain('PRIVATE_FACT_NOT_NEEDED');expect(()=>validateInterpretation({supported:true,answer:'Confiança global de 98,6%. Confira as fontes.',citations:['model-quality'],fields:[],doubts:[]},e)).not.toThrow();expect(()=>validateInterpretation({supported:true,answer:'Economia de 999 reais.',citations:['model-quality'],fields:[],doubts:[]},e)).toThrow();});
});

it('classifies only explicit verified zero CDE Covid without changing raw OCR or its confidence',()=>{
 const prior=process.env.EVA_SOURCE_PREPARATION_V3_ENABLED;
 try{process.env.EVA_SOURCE_PREPARATION_V3_ENABLED='true';const x=fixture();
  const row:any={source:'covid',component:'OTHER',role:'UNKNOWN',issues:['UNMAPPED_COMPONENT'],fields:{description:x.field('CDE-COVID Fora Ponta'),amount:x.field('0.00')},arithmetic:{state:'MATCH'}};x.layout.operations.push(row);
  const before=JSON.stringify({raw:x.raw,row});expect(globalModelLayout(x.raw).operations.at(-1)).toMatchObject({component:'CDE_COVID',role:'CHARGE'});expect(JSON.stringify({raw:x.raw,row})).toBe(before);
  row.fields.amount=x.field('1.00');expect(globalModelLayout(x.raw).operations.at(-1)?.role).toBe('UNKNOWN');
  row.fields.amount=x.field('0.00');row.fields.amount.issues=['UNVERIFIED_SOURCE'];expect(globalModelLayout(x.raw).operations.at(-1)?.role).toBe('UNKNOWN');
 }finally{if(prior===undefined)delete process.env.EVA_SOURCE_PREPARATION_V3_ENABLED;else process.env.EVA_SOURCE_PREPARATION_V3_ENABLED=prior;}
});

it('V3 preserves a proven earlier-period CPFL TUSD complement as a monetary adjustment',()=>{
 const prior=process.env.EVA_SOURCE_PREPARATION_V3_ENABLED;
 try{process.env.EVA_SOURCE_PREPARATION_V3_ENABLED='true';const x=fixture();x.layout.layoutId='cpfl-paulista-a';x.layout.fields.find((f:any)=>f.name==='reference').value=x.field('ABR/2026');
  const adjustment:any={source:'historical',component:'TUSD_ENERGY',role:'CHARGE',issues:[],fields:{description:x.field('Compl TUSD JAN26'),amount:x.field('24.15')},arithmetic:{state:'NOT_VERIFIABLE'}};x.layout.operations.push(adjustment);
  const before=JSON.stringify(adjustment);expect(globalModelLayout(x.raw).operations.at(-1)?.component).toBe('TUSD_BILLING_ADJUSTMENT');expect(JSON.stringify(adjustment)).toBe(before);
  adjustment.fields.description=x.field('Compl TUSD ABR26');expect(globalModelLayout(x.raw).operations.at(-1)?.component).toBe('TUSD_ENERGY');
  adjustment.fields.description=x.field('Compl TUSD MAI26');expect(globalModelLayout(x.raw).operations.at(-1)?.component).toBe('TUSD_ENERGY');
  adjustment.fields.description=x.field('Compl TUSD JAN26');adjustment.fields.amount.issues=['UNVERIFIED_SOURCE'];expect(globalModelLayout(x.raw).operations.at(-1)?.component).toBe('TUSD_ENERGY');
 }finally{if(prior===undefined)delete process.env.EVA_SOURCE_PREPARATION_V3_ENABLED;else process.env.EVA_SOURCE_PREPARATION_V3_ENABLED=prior;}
});
it('V3 tax coverage accounts for normalized zero charge rows without inventing their blank taxes',()=>{
 const prior=process.env.EVA_SOURCE_PREPARATION_V3_ENABLED;
 try{process.env.EVA_SOURCE_PREPARATION_V3_ENABLED='true';const x=fixture();x.layout.operations.push({source:'covid',component:'OTHER',role:'UNKNOWN',issues:['UNMAPPED_COMPONENT'],fields:{description:x.field('CDE-COVID Fora Ponta'),amount:x.field('0.00')},arithmetic:{state:'NOT_VERIFIABLE'}});
  const r=globalModelLayout(x.raw);expect(r.taxReconciliation.checks.find((c:any)=>c.key==='icmsAmount')).toMatchObject({count:1,expected:2,partial:true});expect(r.operations.at(-1)?.fields.icmsAmount).toBeUndefined();
 }finally{if(prior===undefined)delete process.env.EVA_SOURCE_PREPARATION_V3_ENABLED;else process.env.EVA_SOURCE_PREPARATION_V3_ENABLED=prior;}
});

it.each(['CDE-COVID Ponta [kWh] MAR/26','CDE-COVID Fora Ponta [kWh] ABR/26'])('V3 recognizes dated zero row %s with exact source evidence',label=>{
 const prior=process.env.EVA_SOURCE_PREPARATION_V3_ENABLED;
 try{process.env.EVA_SOURCE_PREPARATION_V3_ENABLED='true';const x=fixture();
  const row:any={source:'covid-dated',component:'OTHER',role:'UNKNOWN',issues:['UNMAPPED_COMPONENT'],fields:{description:x.field(label),amount:x.field('0.00')},arithmetic:{state:'NOT_VERIFIABLE'}};x.layout.operations.push(row);
  const before=JSON.stringify({raw:x.raw,row});expect(globalModelLayout(x.raw).operations.at(-1)?.component).toBe('CDE_COVID');expect(JSON.stringify({raw:x.raw,row})).toBe(before);
  process.env.EVA_SOURCE_PREPARATION_V3_ENABLED='false';expect(globalModelLayout(x.raw).operations.at(-1)?.role).toBe('UNKNOWN');
  process.env.EVA_SOURCE_PREPARATION_V3_ENABLED='true';row.fields.amount=x.field('0.01');expect(globalModelLayout(x.raw).operations.at(-1)?.role).toBe('UNKNOWN');
  row.fields.amount=x.field('0.00');row.fields.description=x.field(label+' SERVICO NOVO');expect(globalModelLayout(x.raw).operations.at(-1)?.role).toBe('UNKNOWN');
 }finally{if(prior===undefined)delete process.env.EVA_SOURCE_PREPARATION_V3_ENABLED;else process.env.EVA_SOURCE_PREPARATION_V3_ENABLED=prior;}
});
it.each(['Compl.TUSD Mês JAN/26','Compl.TUSD Mês DEZ/25'])('V3 keeps historic monetary complement %s out of current quantity requirements',label=>{
 const prior=process.env.EVA_SOURCE_PREPARATION_V3_ENABLED;
 try{process.env.EVA_SOURCE_PREPARATION_V3_ENABLED='true';const x=fixture();x.layout.layoutId='cpfl-paulista-a';x.layout.fields.find((f:any)=>f.name==='reference').value=x.field('ABR/2026');
  const row:any={source:'historical-dated',component:'TUSD_ENERGY',role:'CHARGE',issues:[],fields:{description:x.field(label),amount:x.field('24.15')},arithmetic:{state:'NOT_VERIFIABLE'}};x.layout.operations.push(row);
  expect(globalModelLayout(x.raw).operations.at(-1)?.component).toBe('TUSD_BILLING_ADJUSTMENT');expect(globalModelConfidence(x.raw)).toMatchObject({complete:true,consistent:true,state:'READY_FOR_REVIEW'});
  row.fields.description=x.field('Compl.TUSD Mês ABR/26');expect(globalModelLayout(x.raw).operations.at(-1)?.component).toBe('TUSD_ENERGY');
  row.fields.description=x.field('Compl.TUSD Mês MAI/26');expect(globalModelLayout(x.raw).operations.at(-1)?.component).toBe('TUSD_ENERGY');
  row.fields.description=x.field(label);row.fields.description.issues=['UNVERIFIED_SOURCE'];expect(globalModelLayout(x.raw).operations.at(-1)?.component).toBe('TUSD_ENERGY');
 }finally{if(prior===undefined)delete process.env.EVA_SOURCE_PREPARATION_V3_ENABLED;else process.env.EVA_SOURCE_PREPARATION_V3_ENABLED=prior;}
});
