import {reconcileCpflOperations} from './cpfl-reconciliation';
import type {CpflOperation} from './cpfl-paulista-layout';
function sample(){const row=(component:string,value:string,role:CpflOperation['role']='CHARGE')=>({component,role,fields:{amount:{decimal:value},description:{text:component}}} as unknown as CpflOperation);return [row('TUSD_ENERGY','100.00'),row('SUBTOTAL','100.00','TOTAL'),row('TOTAL_DISTRIBUIDORA','100.00','TOTAL'),row('REFUND','-25.00','CREDIT'),row('PUBLIC_LIGHTING','5.00'),row('ADJUSTMENTS_SUBTOTAL','20.00','TOTAL'),row('SUBSIDY_CREDIT','-10.00','CREDIT'),row('TOTAL_A_PAGAR','70.00','TOTAL')];}
describe('CPFL unsigned refund subtotal',()=>{
 it('reconciles only with matching signed details and invoice total, preserving source',()=>{const rows=sample(),before=JSON.stringify(rows);expect(reconcileCpflOperations(rows)).toMatchObject({state:'MATCH',interpretation:'CREDIT_SUBTOTAL_PRINTED_AS_MAGNITUDE'});expect(JSON.stringify(rows)).toBe(before);});
 it('keeps a signed subtotal supported',()=>{const rows=sample();rows[5].fields.amount.decimal='-20.00';expect(reconcileCpflOperations(rows)).toMatchObject({state:'MATCH',interpretation:'SIGNED_SUBTOTAL'});});
 it('rejects inconsistent final total',()=>{const rows=sample();rows[7].fields.amount.decimal='71.00';expect(reconcileCpflOperations(rows).state).toBe('DIVERGENT');});
 it('rejects inconsistent details',()=>{const rows=sample();rows[3].fields.amount.decimal='-24.00';expect(reconcileCpflOperations(rows).state).toBe('DIVERGENT');});
 it('does not infer missing amounts',()=>{const rows=sample();rows[3].fields.amount.decimal=null;expect(reconcileCpflOperations(rows).state).not.toBe('MATCH');});
 it('does not interpret unknown components',()=>{const rows=sample();rows[3].role='UNKNOWN';expect(reconcileCpflOperations(rows).state).not.toBe('MATCH');});
 it('does not reinterpret positive debit subtotals',()=>{const rows=sample();rows[3].fields.amount.decimal='15.00';rows[7].fields.amount.decimal='110.00';expect(reconcileCpflOperations(rows)).toMatchObject({state:'MATCH',interpretation:'SIGNED_SUBTOTAL'});});
});
