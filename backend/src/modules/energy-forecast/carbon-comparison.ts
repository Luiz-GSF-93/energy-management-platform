import { assertEvidence, decimal, quantity, type Evidence, type Scope } from './consumption-forecast';
export type CarbonFactor = { valueTonnesCo2PerMwh: string; source: string; revision: string; month: string; gas: 'CO2' };
export type CarbonInput = Scope & {
  month: string; consumptionKwh: string; coveredKwh: string;
  evidence: Evidence; coverageEvidence: Evidence;
  reference: CarbonFactor | null; contractual: CarbonFactor | null;
};
/** Accounting comparison, not certified avoided emissions, credits or an efficiency saving. */
export function calculateCarbonComparison(input: CarbonInput) {
  assertEvidence(input, input.evidence); assertEvidence(input, input.coverageEvidence);
  if (!/^(20\d{2}|21\d{2})-(0[1-9]|1[0-2])$/.test(input.month)) throw Error('MONTH_INVALID');
  const consumption = quantity(input.consumptionKwh), covered = quantity(input.coveredKwh);
  if (covered > consumption) throw Error('COVERAGE_EXCEEDS_CONSUMPTION');
  const base = { formulaVersion: 'carbon-comparison/1.0', status: 'PRELIMINARY' as const,
    organizationId: input.organizationId, customerId: input.customerId, unitId: input.unitId,
    month: input.month, consumptionKwh: input.consumptionKwh, coveredKwh: input.coveredKwh,
    uncoveredKwh: decimal(consumption - covered), evidence: input.evidence, coverageEvidence: input.coverageEvidence,
    reference: input.reference, contractual: input.contractual,
    label: 'Diferença estimada de emissões', unit: 'tCO2',
    qualification: 'Comparação para o volume documentalmente coberto. Não comprova emissões evitadas no sistema, crédito de carbono ou redução do consumo.' };
  if (!input.reference || !input.contractual) return { ...base, differenceTonnesCo2: null, state: 'FACTORS_REQUIRED' as const };
  for (const factor of [input.reference, input.contractual]) {
    if (factor.month !== input.month || factor.gas !== 'CO2' || !factor.source?.trim() || !factor.revision?.trim()) throw Error('FACTOR_EVIDENCE_INVALID');
    quantity(factor.valueTonnesCo2PerMwh);
  }
  // kWh × (tCO2/MWh) / 1000. Exact integer arithmetic, six decimals, half away from zero.
  const product = covered * (quantity(input.reference.valueTonnesCo2PerMwh) - quantity(input.contractual.valueTonnesCo2PerMwh));
  const divisor = 1000000000n, absolute = product < 0n ? -product : product;
  const result = (absolute + divisor / 2n) / divisor * (product < 0n ? -1n : 1n);
  return { ...base, differenceTonnesCo2: decimal(result), state: 'CALCULATED' as const };
}
