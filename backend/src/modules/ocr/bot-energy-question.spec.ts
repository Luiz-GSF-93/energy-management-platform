import {questionMonth,questionEvidence,questionIntent} from './bot-energy-question';
import {financialAiEvidence} from './backoffice-ai.service';
import {validateInterpretation} from './azure-backoffice-ai.connector';
describe('Questions about unit results and official sources',()=>{
 it.each(['2026-08','08/2026','agosto de 2026','agosto 2026'])('recognizes the requested month in %s',text=>expect(questionMonth('Qual economia em '+text+'?')).toBe('2026-08'));
 it('does not guess among multiple months or a yearless month',()=>{expect(questionMonth('Compare 2026-08 e 2026-09')).toBeNull();expect(questionMonth('qual economia de agosto?')).toBeNull();});
 it.each([['Qual economia em 08/2026?','economy'],['Qual a tarifa do fornecedor em agosto de 2026?','supplier'],['Existe desperdício?','waste'],['Qual a regra de GD?','regulation'],['Qual regra de TUSD?','tariff'],['Qual a demanda?','demand']])('retrieves the intent of %s',(q,intent)=>expect(questionIntent(q)).toBe(intent));
 it('copies exact supplier prices from a proven price even when measurements remain pending',()=>{
  const r=financialAiEvidence({supplier:{status:'BLOCKED',contract:{number:'contract'},rule:{version:1},priceSource:'Histórico validado',pricePerMwh:'245.123456789012',totalAmount:'999.00'}});
  expect(r.map(e=>e.id)).toEqual(['supplier-pricePerMwh']);expect(r[0].value).toBe('245.123456789012');expect(financialAiEvidence({supplier:{status:'BLOCKED',pricePerMwh:'1'}})).toEqual([]);
 });
 it('accepts Portuguese display formatting without accepting different or substring values',()=>{
  const evidence=[{id:'price',label:'Preço',value:'245.120000000000',source:'Fonte revisada'}];
  const output={supported:true,answer:'Preço de 245,12 R$/MWh.',citations:['price'],fields:[],doubts:[]};expect(validateInterpretation(output,evidence).supported).toBe(true);
  expect(()=>validateInterpretation({...output,answer:'Preço de 245,13'},evidence)).toThrow();expect(()=>validateInterpretation({...output,answer:'Preço de 45,12'},evidence)).toThrow();
 });
 it('selects price evidence ahead of irrelevant oversized context and discloses the recut',()=>{
  const evidence=[...Array.from({length:160},(_,i)=>({id:'finding-'+i,label:'Campo',value:'x'.repeat(1000),source:'Fonte'})),{id:'supplier-pricePerMwh',label:'Preço fornecedor',value:'245.12',source:'Contrato'}];
  const selected=questionEvidence('Qual tarifa do fornecedor?',evidence);expect(selected[0].id).toBe('supplier-pricePerMwh');expect(selected.some(e=>e.id==='selected-context')).toBe(true);expect(Buffer.byteLength(JSON.stringify(selected))).toBeLessThan(44000);
 });
});
