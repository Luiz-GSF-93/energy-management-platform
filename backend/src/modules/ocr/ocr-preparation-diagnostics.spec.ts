import {preparationDiagnostics} from './ocr-preparation-diagnostics';
const base=():any=>({unit:{id:'unit',organization_id:'org'},period:{start:'2026-05-01',end:'2026-05-31'},captured:{parameters:[]},diagnosis:{counts:{blockers:2,reviews:0},findings:[]}});
describe('Preparation diagnostics',()=>{
 it('deduplicates an identical cause without dropping financial evidence',()=>{const c=base(),f={code:'IDENTITY_MISMATCH',severity:'BLOCKER',message:'Unidade divergente'};c.diagnosis.findings=[f,{...f}];const r=preparationDiagnostics(c);expect(r.sourceCauses).toBe(1);expect(r.roots[0].findings).toHaveLength(2);expect(r.financialCounts.blockers).toBe(2);expect(c.diagnosis.findings).toHaveLength(2);});
 it('separates review of filled cost drafts from missing source without authorizing approval',()=>{const c=base();c.cost={status:'DRAFT',source_reference:'Extrato recebido'};c.diagnosis.findings=[{code:'COSTS_DRAFT',severity:'BLOCKER',message:'Validar custos'},{code:'UNKNOWN_ERROR',severity:'BLOCKER',message:'Conferir origem'}];expect(preparationDiagnostics(c)).toMatchObject({reviewCauses:1,sourceCauses:1,financialApproval:false});});
 it('preserves missing tariffs as source work when no matching draft exists',()=>{const c=base();c.diagnosis.findings=[{code:'TARIFF_MISSING:ACL',severity:'BLOCKER',message:'Falta tarifa'}];expect(preparationDiagnostics(c).sourceCauses).toBe(1);});
});
