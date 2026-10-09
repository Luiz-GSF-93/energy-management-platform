import {monthlyAverage} from './monthly-average';
describe('documented same-month average policy',()=>{
 it('uses two previous occurrences of the target month instead of other seasons',()=>{
  expect(monthlyAverage([10,90,30,100],['2024-09','2024-10','2025-09','2025-10'],'2026-09')).toEqual({daily:20,basis:'SAME_MONTH',sourceMonths:['2024-09','2025-09']});
 });
 it('falls back to all available observations with only one matching month',()=>{
  expect(monthlyAverage([10,90,50],['2025-09','2025-10','2025-11'],'2026-09')).toEqual({daily:50,basis:'AVAILABLE_PERIOD',sourceMonths:['2025-09','2025-10','2025-11']});
 });
 it('does not treat zero consumption as missing and does not mutate sources',()=>{
  const months=['2024-02','2025-02'],values=[0,100];
  expect(monthlyAverage(values,months,'2026-02').daily).toBe(50);expect(values).toEqual([0,100]);expect(months).toEqual(['2024-02','2025-02']);
 });
 it('uses only the training subset supplied at a chronological origin',()=>{
  expect(monthlyAverage([10],['2024-09'],'2025-09').basis).toBe('AVAILABLE_PERIOD');
  expect(monthlyAverage([10,30],['2024-09','2025-09'],'2026-09').daily).toBe(20);
 });
 it('rejects empty or mismatched series',()=>{
  expect(()=>monthlyAverage([],[],'2026-09')).toThrow();expect(()=>monthlyAverage([1],[],'2026-09')).toThrow();
 });
});
