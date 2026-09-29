import {elektroEffectiveRate as effective} from './elektro-effective-rate';
describe('invoice effective rate',()=>{
 it('reconstructs only a billed cost within printed precision',()=>expect(effective('181778','0.175910','31976.64')).toMatchObject({rateMwh:'175.910396',printedRateKwh:'0.175910',basis:'BILLED_EFFECTIVE'}));
 it('rejects materially inconsistent values',()=>expect(effective('181778','0.175910','32000.00')).toBeNull());
 it('rejects absent/zero quantity and unsupported precision',()=>{expect(effective('0','0.175910','1.00')).toBeNull();expect(effective('181778','0.17','31976.64')).toBeNull();});
});
