import {demandLineClassification as classify} from './demand-line-classification';
const row=(text:string):any=>({fields:{description:{text,issues:[]}},issues:[]});
describe('Explicit demand usage labels',()=>{
 it.each(['Uso Sist. Distr. Demanda Utilizada','DEMANDA UTILIZADA PONTA','Demanda utilizada fora ponta'])('recognizes literal used label %s',text=>expect(classify(row(text)).kind).toBe('USED_EXPLICIT'));
 it.each(['Uso Sist. Distr. Demanda não utilizada','DEMANDA NAO UTILIZADA','Demanda não-utilizada'])('recognizes literal unused label %s',text=>expect(classify(row(text)).kind).toBe('UNUSED_EXPLICIT'));
 it.each(['Uso Sist. Distr. 49,99 Desc AGO/26','Demanda contratada','Demanda medida','Demanda ultrapassagem','Demanda utilizada e demanda não utilizada','Sem demanda utilizada','Não demanda utilizada',''])('preserves ambiguity for %s',text=>expect(classify(row(text)).kind).toBe('UNCLASSIFIED'));
 it('rejects unverified description',()=>{const r=row('Demanda utilizada');r.fields.description.issues=['UNVERIFIED_SOURCE'];expect(classify(r).kind).toBe('UNCLASSIFIED');});
 it('rejects merged source',()=>{const r=row('Demanda não utilizada');r.issues=['MERGED_OR_DUPLICATE_CELL'];expect(classify(r).kind).toBe('UNCLASSIFIED');});
 it('does not infer from values or taxes',()=>{const r=row('Uso Sist. Distr.');r.fields.quantity={decimal:'265.3600'};r.fields.icmsRate={decimal:'0'};expect(classify(r).kind).toBe('UNCLASSIFIED');});
});
