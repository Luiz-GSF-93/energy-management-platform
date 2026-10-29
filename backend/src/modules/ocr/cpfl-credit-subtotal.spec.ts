import {cpflCreditSubtotal} from './cpfl-credit-subtotal';
import {reconcileCpflOperations} from './cpfl-reconciliation';
import type {CpflOperation} from './cpfl-paulista-layout';
function sample(){
 const row=(component:string,amount:string,role:CpflOperation['role']='CHARGE',label=component)=>({source:'tables[3].row[0]',row:0,component,role,period:'ALL',fields:{description:{text:label,issues:[]},amount:{text:amount,decimal:amount,issues:[]}},issues:[],arithmetic:{state:'NOT_VERIFIABLE',differenceCents:null}} as unknown as CpflOperation);
 return [row('TUSD_ENERGY','28847.13'),row('SUBTOTAL','28847.13','TOTAL'),row('TOTAL_DISTRIBUIDORA','28847.13','TOTAL'),row('ACL_ENERGY_DISCOUNT','-1847.51','CREDIT'),row('ACL_ENERGY_DISCOUNT','-10153.66','CREDIT'),row('REFUND','-1.26','CREDIT'),row('OTHER','-12002.43','UNKNOWN',''),row('SUBSIDY_CREDIT','-4056.06','CREDIT'),row('TOTAL_A_PAGAR','12788.64','TOTAL')].map((r,i)=>({...r,row:i,source:`tables[3].row[${i}]`}));
}
describe('CPFL unlabelled credit subtotal',()=>{
 it('requires both exact sums and preserves every original field and detailed credit',()=>{
  const rows=sample(),before=JSON.stringify(rows),r=cpflCreditSubtotal(rows,()=>true);
  expect(r.proof).toMatchObject({source:'tables[3].row[6]',subtotalCents:'-1200243',finalCents:'1278864'});
  expect(reconcileCpflOperations(r.operations).state).toBe('MATCH');expect(r.operations[6].fields).toBe(rows[6].fields);expect(r.operations.filter(x=>x.role==='CREDIT')).toHaveLength(4);expect(JSON.stringify(rows)).toBe(before);
 });
 it.each(['final','detail','prefix','duplicate','label','extraField','merged','source','missingTotal','foreignTable','unknownDetail','positive'])('keeps review for %s instead of guessing',kind=>{
  const rows=sample();
  if(kind==='final')rows[8].fields.amount.decimal='12788.65';
  if(kind==='detail')rows[5].fields.amount.decimal='-1.25';
  if(kind==='prefix')rows[0].fields.amount.decimal='28847.12';
  if(kind==='duplicate')rows.splice(7,0,{...rows[6],source:'tables[3].row[100]'});
  if(kind==='label')rows[6].fields.description.text='Crédito comprovado';
  if(kind==='extraField')rows[6].fields.quantity={text:'1'} as any;
  if(kind==='merged')rows[6].issues.push('MERGED_OR_DUPLICATE_CELL');
  if(kind==='source')rows[6].source='';
  if(kind==='missingTotal')rows.pop();
  if(kind==='foreignTable')rows[6].source='tables[4].row[6]';
  if(kind==='unknownDetail')rows[3].role='UNKNOWN';
  if(kind==='positive')rows[6].fields.amount.decimal='12002.43';
  expect(cpflCreditSubtotal(rows,()=>true).proof).toBeNull();
 });
 it('does not bypass missing confidence/source verification',()=>expect(cpflCreditSubtotal(sample(),(_,amountOnly)=>!amountOnly).proof).toBeNull());
 it('preserves existing labelled subtotal reconciliation',()=>{const rows=sample();rows[6].component='ADJUSTMENTS_SUBTOTAL';rows[6].role='TOTAL';rows[6].fields.description.text='Devolução';expect(cpflCreditSubtotal(rows,()=>true).proof).toBeNull();expect(reconcileCpflOperations(rows).state).toBe('MATCH');});
});
