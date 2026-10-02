import {assistantHistory} from './ocr-assistant-history';
const row=(id:string,month:string,value:unknown,status='VALIDATED',version=1)=>({id,month,status,version,revision:1,measurements:{consumptionTotal:value}});
describe('OCR assistant history',()=>{
 it('uses the newest validated version of the last three distinct months',()=>{
  const result=assistantHistory('125',[row('draft','2026-07','100','DRAFT'),row('latest','2026-07','100','VALIDATED',2),row('old','2026-07','90'),row('june','2026-06','100'),row('may','2026-05','100'),row('april','2026-04','100')]);
  expect(result.map(r=>r.inputId)).toEqual(['latest','june','may']);
 });
 it.each([undefined,null,'','NaN'])('does not turn missing or malformed values into zero: %s',value=>{
  expect(assistantHistory(value,[row('previous','2026-07','100')])[0].state).toBe('MISSING_DATA');
  expect(assistantHistory('100',[row('previous','2026-07',value)])[0].state).toBe('MISSING_DATA');
 });
 it('does not divide by an explicitly zero reference',()=>expect(assistantHistory('100',[row('zero','2026-07','0')])[0].state).toBe('ZERO_REFERENCE'));
 it.each([['1.25','COMPARABLE'],['1.250001','REVIEW_VARIATION'],['0.75','COMPARABLE'],['0.749999','REVIEW_VARIATION']])('compares the exact advisory boundary %s', (value,state)=>expect(assistantHistory(value,[row('previous','2026-07','1')])[0].state).toBe(state));
});
