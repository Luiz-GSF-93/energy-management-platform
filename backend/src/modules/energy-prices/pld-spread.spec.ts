import {pldSpreadScenarios} from './pld-spread';

describe('PLD market scenarios in BRL/MWh', () => {
  it('keeps the three estimates separate and rounds at the end', () => {
    expect(pldSpreadScenarios('180.123456')).toEqual({
      pldSpread5: '189.13', pldSpread10: '198.14', pldSpread15: '207.14',
    });
    expect(pldSpreadScenarios('0.0049').pldSpread15).toBe('0.01');
  });
  it('does not replace missing market data with zero', () => {
    expect(pldSpreadScenarios(null)).toEqual({
      pldSpread5: null, pldSpread10: null, pldSpread15: null,
    });
    expect(pldSpreadScenarios('0').pldSpread15).toBe('0.00');
  });
  it('rejects negative and malformed prices', () => {
    for (const value of ['-1', 'NaN', '180,12']) {
      expect(() => pldSpreadScenarios(value)).toThrow();
    }
  });
});

import {observedPriceComparisons} from './pld-spread';
describe('signed price performance and explicit tax comparability',()=>{
 it('compares all five references without changing the financial score',()=>{const r=observedPriceComparisons('150.00','100.00','200.00','125.00',pldSpreadScenarios('125.00'),'NET');expect(r.map(v=>v.percent)).toEqual(['-50.00','-20.00','-23.81','-27.27','-30.43']);expect(r.every(v=>v.basis==='NET_COMPARABLE')).toBe(true);});
 it('marks mixed tax bases as nominal and uses gross prices only for the gross ACR reference',()=>{const r=observedPriceComparisons('150.00',null,'200.00','100.00',pldSpreadScenarios('100.00'),'GROSS');expect(r[0]).toMatchObject({percent:'-25.00',basis:'GROSS_COMPARABLE'});expect(r[1]).toMatchObject({percent:'50.00',basis:'NOMINAL_UNCONFIRMED'});});
 it('leaves missing and zero references unavailable rather than divide by zero',()=>{expect(observedPriceComparisons(null,null,null,null,pldSpreadScenarios(null),'NET').every(v=>v.percent===null)).toBe(true);expect(observedPriceComparisons('100.00',null,'0.00','0.00',pldSpreadScenarios('0.00'),'NET').every(v=>v.percent===null)).toBe(true);});
});
