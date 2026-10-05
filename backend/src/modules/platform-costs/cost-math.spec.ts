import {monthlyProjection,brlMinor,budgetLevel} from './cost-math';
describe('Platform cost estimates',()=>{
 it('uses elapsed UTC time, never projects before a full day or for future months',()=>{expect(monthlyProjection(100,'2026-10',new Date('2026-10-01T12:00Z'))).toBeNull();expect(monthlyProjection(100,'2026-11',new Date('2026-10-04T12:00Z'))).toBeNull();expect(monthlyProjection(100,'2026-09',new Date('2026-10-04T12:00Z'))).toBe(100);expect(monthlyProjection(100,'2026-10',new Date('2026-10-03T00:00Z'))).toBe(1550);});
 it('does not invent exchange rates or treat missing costs as zero',()=>{expect(brlMinor(100,'USD',null)).toBeNull();expect(brlMinor(100,'BRL',null)).toBe(100);expect(brlMinor(100,'USD',5.25)).toBe(525);expect(()=>brlMinor(-100,'USD',5)).toThrow();});
 it('alerts on retained reservations and projections before exhaustion',()=>{expect(budgetLevel(80,100,null)).toBe('WARNING');expect(budgetLevel(95,100,null)).toBe('CRITICAL');expect(budgetLevel(100,100,null)).toBe('LIMIT');expect(budgetLevel(10,100,120)).toBe('FORECAST');expect(budgetLevel(10,0,120)).toBeNull();});
});
