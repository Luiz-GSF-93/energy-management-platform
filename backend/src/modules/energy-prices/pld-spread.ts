import {feeMoney} from '../contracts/services/management-fee';
import {decimal} from './energy-price-score';

/** Price projections only; never a supplier quote or a tax-normalized comparison. */
export function pldSpreadScenarios(value: string | null) {
  const estimate = (percent: 5 | 10 | 15) => {
    if (value === null) return null;
    const scaled = decimal(value) * BigInt(100 + percent);
    return feeMoney((scaled + 500000000n) / 1000000000n);
  };
  return {
    pldSpread5: estimate(5),
    pldSpread10: estimate(10),
    pldSpread15: estimate(15),
  };
}
