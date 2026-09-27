import {demandTaxReview as review} from './demand-tax-review';
const row=(field:any):any=>({source:'tables[0].row[3]',issues:[],fields:{icmsAmount:field,pisAmount:{text:'24,00',decimal:'24.00',issues:[],pages:[1],confidence:null},cofinsAmount:{text:'112,55',decimal:'112.55',issues:[],pages:[1],confidence:null}}});
describe('Demand tax review projection',()=>{
 it('preserves the Del Rei pattern without inventing ICMS zero',()=>{const r=review(row(undefined));expect(r.map(f=>f.state)).toEqual(['MISSING','POSITIVE','POSITIVE']);expect(r[0].decimal).toBeNull();expect(r[1]).toMatchObject({decimal:'24.00',confidence:null,pages:[1],source:'tables[0].row[3].pisAmount'});});
 it('distinguishes explicit zero from absence',()=>expect(review(row({text:'0,00',decimal:'0.00',issues:[],pages:[1]}))[0].state).toBe('ZERO'));
 it.each(['-','abc','-1'])('does not approve nonnumeric or negative %s',text=>expect(review(row({text,decimal:text,issues:[]}))[0].state).toBe('REVIEW'));
 it.each(['UNVERIFIED_SOURCE','CONFIDENCE_BELOW_45','CONFIDENCE_REVIEW'])('keeps field issue %s in review',issue=>expect(review(row({text:'0',decimal:'0',issues:[issue]}))[0].state).toBe('REVIEW'));
 it('shows extracted values with missing confidence without claiming approval',()=>{const r=review(row({text:'12,00',decimal:'12.00',issues:['MISSING_CONFIDENCE'],pages:[1],confidence:null}))[0];expect(r.state).toBe('POSITIVE');expect(r.confidenceMessage).toContain('exige conferência');});
 it('retains merged row ambiguity',()=>{const r=row({text:'0',decimal:'0',issues:[]});r.issues=['MERGED_OR_DUPLICATE_CELL'];expect(review(r)[0].state).toBe('REVIEW');});
 it('does not mutate evidence',()=>{const r=row({text:'0',decimal:'0',issues:[]}),copy=JSON.stringify(r);review(r);expect(JSON.stringify(r)).toBe(copy);});
});
