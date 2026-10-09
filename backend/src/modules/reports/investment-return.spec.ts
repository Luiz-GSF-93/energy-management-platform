import {investmentReturn} from './investment-return';
const item=(amount='100',date='2026-01-01',classification='REALIZED')=>({category:'MIGRATION',description:'Migração',amount,date,classification,source:'Documento conferido da migração da unidade.'});
const snapshot=(items:any[]=[item()])=>({id:'version',version:1,payload_hash:'hash',body:{startMonth:'2026-01',items}});
const months=(amounts:string[])=>(amounts.map((v,i)=>({month:`2026-${String(i+1).padStart(2,'0')}`,totals:{savingsAfterFees:v}})));
describe('Published investment return',()=>{
 it('calculates simple ROI from net savings and recovers in the correct month',()=>{expect(investmentReturn(snapshot(),months(['60.00','60.00']),'2026-02')).toMatchObject({state:'CALCULATED',investment:'100.00',savings:'120.00',netCash:'20.00',roiPercent:'20.00',paybackMonths:'1.67'});});
 it('preserves negative savings without manufacturing recovery',()=>{expect(investmentReturn(snapshot(),months(['-20.00','10.00']),'2026-02')).toMatchObject({roiPercent:'-110.00',paybackMonths:null});});
 it('does not replace absent months by zero',()=>{expect(investmentReturn(snapshot(),months(['60.00']),'2026-02').state).toBe('INCOMPLETE_PUBLISHED_COVERAGE');});
 it('rejects duplicated monthly coverage and unreported totals',()=>{const m=months(['60.00']);expect(investmentReturn(snapshot(),[...m,...m],'2026-02').state).toBe('INCOMPLETE_PUBLISHED_COVERAGE');expect(investmentReturn(snapshot(),[{month:'2026-01',totals:null}],'2026-01').state).toBe('INCOMPLETE_PUBLISHED_COVERAGE');});
 it('never uses estimated investments as realized returns',()=>{expect(investmentReturn(snapshot([item('100','2026-01-01','ESTIMATED')]),months(['120.00']),'2026-01').state).toBe('ESTIMATED_INVESTMENT_PENDING');});
 it('does not divide by zero',()=>{expect(investmentReturn(snapshot([item('0')]),months(['120.00']),'2026-01')).toMatchObject({state:'NO_INVESTMENT',roiPercent:null,paybackMonths:null});});
 it('deducts subsequent investments in their month and invalidates an earlier recovery',()=>{expect(investmentReturn(snapshot([item(),item('500','2026-02-01')]),months(['120.00','20.00']),'2026-02')).toMatchObject({investment:'600.00',netCash:'-460.00',paybackMonths:null});});
 it('excludes future investments outside the horizon',()=>{expect(investmentReturn(snapshot([item(),item('500','2027-01-01','ESTIMATED')]),months(['120.00']),'2026-01')).toMatchObject({state:'CALCULATED',investment:'100.00',roiPercent:'20.00'});});
 it('deducts investments before the first month exactly once',()=>{expect(investmentReturn(snapshot([item('100','2025-12-01')]),months(['120.00']),'2026-01')).toMatchObject({netCash:'20.00',roiPercent:'20.00'});});
 it('does not project a cut before tracking started',()=>{expect(investmentReturn(snapshot(),[],'2025-12').state).toBe('BEFORE_TRACKING_START');});
});
