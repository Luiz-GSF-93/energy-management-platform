import {cpflCreditSubtotal} from './cpfl-credit-subtotal';
import {reconcileCpflOperations} from './cpfl-reconciliation';
import type {CpflOperation} from './cpfl-paulista-layout';
function sample(){
 const row=(component:string,amount:string,role:CpflOperation['role']='CHARGE',label=component)=>({source:'tables[3].row[0]',row:0,component,role,period:'ALL',fields:{description:{text:label,issues:[]},amount:{text:amount,decimal:amount,issues:[]}},issues:[],arithmetic:{state:'NOT_VERIFIABLE',differenceCents:null}} as unknown as CpflOperation);
 return [row('TUSD_ENERGY','28847.13'),row('SUBTOTAL','28847.13','TOTAL'),row('TOTAL_DISTRIBUIDORA','28847.13','TOTAL'),row('ACL_ENERGY_DISCOUNT','-1847.51','CREDIT'),row('ACL_ENERGY_DISCOUNT','-10153.66','CREDIT'),row('REFUND','-1.26','CREDIT'),row('OTHER','-12002.43','UNKNOWN',''),row('SUBSIDY_CREDIT','-4056.06','CREDIT'),row('TOTAL_A_PAGAR','12788.64','TOTAL')].map((r,i)=>({...r,row:i,source:`tables[3].row[${i}]`}));
}
function mixedSample(){
 const rows=sample(),amounts=['37620.91','37620.91','37620.91','9.47','-2365.87','-13637.63','-15994.03','-4776.55','16850.33'];
 rows.forEach((r,i)=>{r.fields.amount={...r.fields.amount,text:amounts[i],decimal:amounts[i]};});
 rows[3]={...rows[3],role:'CHARGE',component:'TUSD_BILLING_ADJUSTMENT',fields:{...rows[3].fields,description:{...rows[3].fields.description,text:'Compl.TUSD Mês JAN/26'}}};
 rows[5]={...rows[5],component:'ACL_ENERGY_DISCOUNT'};return rows;
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
 it('recognizes an exact subtotal with a verified TUSD complement without dropping or duplicating its charge',()=>{
  const rows=mixedSample(),before=JSON.stringify(rows),r=cpflCreditSubtotal(rows,()=>true);
  expect(r.proof).toMatchObject({method:'CPFL_UNLABELLED_CREDIT_SUBTOTAL_WITH_TUSD_ADJUSTMENTS_EXACT_SUMS',billingAdjustmentSources:['tables[3].row[3]'],subtotalCents:'-1599403',finalCents:'1685033'});
  expect(reconcileCpflOperations(r.operations).state).toBe('MATCH');expect(r.operations[3]).toBe(rows[3]);expect(r.operations[6].role).toBe('TOTAL');expect(r.operations[6].fields).toBe(rows[6].fields);
  const cents=r.operations.filter(x=>['CHARGE','CREDIT'].includes(x.role)).reduce((n,x)=>n+BigInt(x.fields.amount.decimal!.replace('.','')),0n);
  expect(cents).toBe(1685033n);expect(JSON.stringify(rows)).toBe(before);
 });
 it.each(['cent','negative','unknownCharge','notVerifiedEarlierPeriod','duplicate','merged','source','unverified'])('keeps mixed subtotal review for %s',kind=>{
  const rows=mixedSample();
  if(kind==='cent')rows[3].fields.amount.decimal='9.48';
  if(kind==='negative')rows[3].fields.amount.decimal='-9.47';
  if(kind==='unknownCharge')rows[3].component='OTHER';
  if(kind==='notVerifiedEarlierPeriod')rows[3].component='TUSD_ENERGY';
  if(kind==='duplicate')rows[3].source=rows[4].source;
  if(kind==='merged')rows[3].issues.push('MERGED_OR_DUPLICATE_CELL');
  if(kind==='source')rows[3].source='';
  expect(cpflCreditSubtotal(rows,r=>kind!=='unverified'||r!==rows[3]).proof).toBeNull();
 });
 it('preserves existing labelled subtotal reconciliation',()=>{const rows=sample();rows[6].component='ADJUSTMENTS_SUBTOTAL';rows[6].role='TOTAL';rows[6].fields.description.text='Devolução';expect(cpflCreditSubtotal(rows,()=>true).proof).toBeNull();expect(reconcileCpflOperations(rows).state).toBe('MATCH');});
});
