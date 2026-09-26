import {supplierVolumeLimits} from './supplier-volume-limits';
describe('Supplier upper tolerance above contracted volume', () => {
 const scale=10n**12n;
 it.each([[60,70,0],[70,70,0],[100,100,0],[120,120,0],[130,130,0],[140,130,10]])('100 MWh, minimum 70%, tolerance 30%: consumption %s', (consumption,billed,extra) => {
  const {min,max}=supplierVolumeLimits(100n*scale,'70','30');
  expect(min).toBe(70n*scale); expect(max).toBe(130n*scale);
  const measured=BigInt(consumption)*scale, covered=measured>max?max:measured;
  expect(covered<min?min:covered).toBe(BigInt(billed)*scale);
  expect(measured-covered).toBe(BigInt(extra)*scale);
 });
 it('zero tolerance keeps the contractual volume as the upper limit',()=>{expect(supplierVolumeLimits(100n*scale,'70','0').max).toBe(100n*scale);});
 it('preserves fractional percentages without floating-point arithmetic',()=>{expect(supplierVolumeLimits(100n*scale,'70.125','30.125')).toEqual({min:70125000000000n,max:130125000000000n});});
 it.each(['-1','NaN','Infinity','30%','10000','30.12345'])('rejects invalid upper tolerance %s',value=>{expect(()=>supplierVolumeLimits(100n*scale,'70',value)).toThrow();});
 it('rejects minimum above the resulting upper limit',()=>{expect(()=>supplierVolumeLimits(100n*scale,'131','30')).toThrow();});
});
