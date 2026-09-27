import {kwhRateToMwh,cdeParameterCandidates} from './cde-parameter-candidates';
const field=(text:string,decimal:string|null=text)=>({text,decimal,pages:[1],spans:[],issues:['MISSING_CONFIDENCE'],confidence:null,transcription:{state:'VERIFIED_WORDS',confidence:.99,wordCount:1,method:'MINIMUM_WORD_CONFIDENCE'}});
function row(band='PEAK'):any{return {role:'CHARGE',component:'CDE_WATER_SCARCITY',period:band,source:band,issues:[],fields:{description:field('TUSD'),unit:field('kWh',null),quantity:field('11378.6400'),grossRate:field('0.98192227'),amount:field('11172.94'),icmsAmount:field('2011.13'),pisAmount:field('94.37'),cofinsAmount:field('442.52')}};}
describe('Exact TUSD draft mapping',()=>{
 it.each([['0.21265684','212.65684'],['0.98192227','981.92227'],['0.000000001','0.000001'],['1','1000']])('converts %s without rounding',(a,b)=>expect(kwhRateToMwh(a)).toBe(b));
 it.each(['-1','0.0000000001','NaN','1000000000'])('rejects unsupported %s',v=>expect(()=>kwhRateToMwh(v)).toThrow());
 it('reconciles actual peak operation',()=>expect(cdeParameterCandidates([row()])[0]).toMatchObject({ready:true,rateMwh:'981.92227',amount:'11172.94'}));
 it('reconciles actual off peak operation',()=>{const r=row('OFF_PEAK');r.fields.quantity=field('99743.5600');r.fields.grossRate=field('0.21265684');r.fields.amount=field('21211.15');expect(cdeParameterCandidates([r])[1].ready).toBe(true);});
 it('blocks duplicate lines',()=>expect(cdeParameterCandidates([row(),row()])[0].ready).toBe(false));
 it('blocks missing taxes, confidence, units and mismatched totals',()=>{for(const change of [(r:any)=>r.fields.icmsAmount=field(''),(r:any)=>r.fields.grossRate.transcription.confidence=.85,(r:any)=>r.fields.unit=field('MWh'),(r:any)=>r.fields.amount=field('11172.95')]){const r=row();change(r);expect(cdeParameterCandidates([r])[0].ready).toBe(false);}});
});

describe('CDE invoice evidence',()=>{it.each([['PEAK','11378.6400','0.00502609','57.19'],['OFF_PEAK','99743.5600','0.00502629','501.34']])('maps %s exactly',(band,qty,rate,amount)=>{const r=row(band);r.fields.quantity=field(qty);r.fields.grossRate=field(rate);r.fields.amount=field(amount);expect(cdeParameterCandidates([r])[band==='PEAK'?0:1].ready).toBe(true);r.fields.description.transcription.confidence=.299;expect(cdeParameterCandidates([r])[band==='PEAK'?0:1].ready).toBe(false);});});
