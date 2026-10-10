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
