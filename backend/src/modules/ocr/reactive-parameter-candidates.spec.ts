import {reactiveParameterCandidates} from './reactive-parameter-candidates';
const field=(text:string,decimal:string|null=null)=>({text,decimal,pages:[1],confidence:0.9,issues:[]});
const rows=()=>['PEAK','OFF_PEAK'].map((period,i)=>({role:'CHARGE',component:'REACTIVE_ENERGY',period,source:'row'+i,issues:[],fields:{description:field('USD Consumo Reativo '+period),unit:field('kWh'),quantity:field(i?'121,4116':'0,9716',i?'121.4116':'0.9716'),grossRate:field(i?'0,37599373':'0,36023055',i?'0.37599373':'0.36023055'),amount:field(i?'45,65':'0,35',i?'45.65':'0.35')}})) as any[];
describe('reactive OCR candidates',()=>{
 it('keeps exact source quantity/rate and cent reconciliation',()=>{const r=reactiveParameterCandidates(rows());expect(r.every(v=>v.ready)).toBe(true);expect(r[0]).toMatchObject({quantity:'0.9716',rateMwh:'360.23055',amount:'0.35'});});
 it('does not assume missing tax highlight is zero',()=>{const r=reactiveParameterCandidates(rows());expect(r[0]).not.toHaveProperty('pis');});
 it.each(['quantity','grossRate','amount','unit','description'])('blocks low-confidence %s',key=>{const r=rows();r[0].fields[key].confidence=0.84;expect(reactiveParameterCandidates(r)[0].ready).toBe(false);});
 it('accepts verified words at high confidence when cell confidence is unavailable',()=>{const r=rows();r[0].fields.quantity.confidence=null;r[0].fields.quantity.transcription={state:'VERIFIED_WORDS',confidence:0.9};expect(reactiveParameterCandidates(r)[0].ready).toBe(true);});
 it.each(['duplicate','missing','unit','arithmetic','merged'])('blocks %s evidence',issue=>{const r=rows();if(issue==='duplicate')r.push(r[0]);if(issue==='missing')r.shift();if(issue==='unit')r[0].fields.unit.text='kVArh';if(issue==='arithmetic')r[0].fields.amount.decimal='1.00';if(issue==='merged')r[0].issues=['MERGED_OR_DUPLICATE_CELL'];expect(reactiveParameterCandidates(r)[0].ready).toBe(false);});
});

describe('Elektro independently documented reactive bands',()=>{
 it('keeps only off peak and preserves the default CPFL requirement',()=>{const r=rows().slice(1);expect(reactiveParameterCandidates(r,'neoenergia-elektro-verde')).toHaveLength(1);expect(reactiveParameterCandidates(r,'neoenergia-elektro-verde')[0]).toMatchObject({band:'OFF_PEAK',ready:true});expect(reactiveParameterCandidates(r)[0].ready).toBe(false);});
 it('does not accept absent or ambiguous bands',()=>{expect(reactiveParameterCandidates([],'neoenergia-elektro-verde').every(r=>r.ready)).toBe(false);const r=rows().slice(1);r[0].period='UNKNOWN';expect(reactiveParameterCandidates(r,'neoenergia-elektro-verde').every(r=>r.ready)).toBe(false);});
 it('does not discard duplicate or low confidence rows',()=>{const r=rows().slice(1);expect(reactiveParameterCandidates([...r,...r],'neoenergia-elektro-verde')[0].ready).toBe(false);r[0].fields.amount.confidence=0.1;expect(reactiveParameterCandidates(r,'neoenergia-elektro-verde')[0].ready).toBe(false);});
});
