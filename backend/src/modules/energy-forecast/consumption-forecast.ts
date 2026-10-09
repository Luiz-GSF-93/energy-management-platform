/** Pure preliminary calculation. No database, network, publication or permission decisions. */
export const FORECAST_FORMULA_VERSION = 'consumption-forecast/1.0';
export type Scope = { organizationId: string; customerId: string; unitId: string };
export type Evidence = Scope & { id: string; revision: number; hash: string; validatedBy: string; validatedAt: string };
export type Observation = { month: string; consumptionKwh: string; billedDays: number; evidence: Evidence };
export type Expansion = { startMonth: string; endMonth: string; monthlyKwh: string; evidence: Evidence };
export type ForecastInput = Scope & { asOfMonth: string; observations: Observation[]; expansions: Expansion[] };
type Method = 'MEAN_DAILY' | 'LINEAR_DAILY' | 'SEASONAL_DAILY';
const scale = 1000000n;
export function quantity(value: string): bigint {
  if (typeof value !== 'string' || !/^(0|[1-9]\d{0,11})(\.\d{1,6})?$/.test(value)) throw Error('QUANTITY_INVALID');
  const [whole, fraction = ''] = value.split('.');
  return BigInt(whole) * scale + BigInt(fraction.padEnd(6, '0'));
}
export function decimal(value: bigint): string {
  const sign = value < 0n ? '-' : ''; const absolute = value < 0n ? -value : value;
  return sign + String(absolute / scale) + '.' + String(absolute % scale).padStart(6, '0');
}
export function monthIndex(month: string): number {
  if (!/^(20\d{2}|21\d{2})-(0[1-9]|1[0-2])$/.test(month)) throw Error('MONTH_INVALID');
  return Number(month.slice(0, 4)) * 12 + Number(month.slice(5)) - 1;
}
const monthName = (index: number) => String(Math.floor(index / 12)) + '-' + String(index % 12 + 1).padStart(2, '0');
export function assertEvidence(scope: Scope, evidence: Evidence) {
  if (!evidence || ['organizationId', 'customerId', 'unitId'].some(k => !scope[k as keyof Scope] || evidence[k as keyof Scope] !== scope[k as keyof Scope])) throw Error('SOURCE_SCOPE_INVALID');
  if (!evidence.id?.trim() || !Number.isSafeInteger(evidence.revision) || evidence.revision < 1 || !/^[a-f0-9]{64}$/.test(evidence.hash) || !evidence.validatedBy?.trim() || !/^\d{4}-\d{2}-\d{2}T/.test(evidence.validatedAt) || !Number.isFinite(Date.parse(evidence.validatedAt))) throw Error('SOURCE_NOT_VALIDATED');
}
function predict(values: number[], method: Method, horizon: number): number {
  const n = values.length;
  if (method === 'SEASONAL_DAILY') return values[n - 12 + (horizon - 1) % 12];
  const mean = values.reduce((a, b) => a + b, 0) / n;
  if (method === 'MEAN_DAILY') return mean;
  const center = (n - 1) / 2;
  let covariance = 0, variance = 0;
  values.forEach((value, i) => { covariance += (i - center) * (value - mean); variance += (i - center) ** 2; });
  return mean + covariance / variance * (n - 1 + horizon - center);
}
const rounded = (value: number) => {
  const scaled = Math.round(value * 1000000);
  if (!Number.isFinite(value) || value < 0 || !Number.isSafeInteger(scaled)) throw Error('PREDICTION_REVIEW_REQUIRED');
  return BigInt(scaled);
};
export function calculateConsumptionForecast(input: ForecastInput) {
  const cutoff = monthIndex(input.asOfMonth);
  if (!Array.isArray(input.observations) || input.observations.length < 12 || input.observations.length > 36 || !Array.isArray(input.expansions) || input.expansions.length > 100) throw Error('HISTORY_12_TO_36_REQUIRED');
  const rows = [...input.observations].sort((a, b) => monthIndex(a.month) - monthIndex(b.month));
  const sourceKeys = new Set<string>();
  rows.forEach((row, i) => {
    assertEvidence(input, row.evidence);
    if (quantity(row.consumptionKwh) > BigInt(Number.MAX_SAFE_INTEGER)) throw Error('QUANTITY_NUMERIC_RANGE');
    const index = monthIndex(row.month);
    if (index !== cutoff - rows.length + 1 + i) throw Error('HISTORY_GAP_DUPLICATE_OR_FUTURE');
    if (!Number.isInteger(row.billedDays) || row.billedDays < 1 || row.billedDays > 62) throw Error('BILLED_DAYS_INVALID');
    sourceKeys.add(row.evidence.id + ':' + row.evidence.revision + ':' + row.evidence.hash);
  });
  const expansionKeys = new Set<string>();
  input.expansions.forEach(e => {
    assertEvidence(input, e.evidence); quantity(e.monthlyKwh);
    if (monthIndex(e.startMonth) <= cutoff || monthIndex(e.endMonth) < monthIndex(e.startMonth)) throw Error('EXPANSION_ALREADY_IN_HISTORY_OR_INVALID');
    if (expansionKeys.has(e.evidence.id)) throw Error('EXPANSION_DUPLICATE');
    expansionKeys.add(e.evidence.id);
  });
  const daily = rows.map(r => Number(quantity(r.consumptionKwh)) / 1000000 / r.billedDays);
  const candidates: Method[] = ['MEAN_DAILY', 'LINEAR_DAILY'];
  // Six chronological origins with at least two annual cycles before a seasonal candidate.
  if (rows.length >= 30) candidates.push('SEASONAL_DAILY');
  const scores: { method: Method; maeKwh: string; predictions: number }[] = [];
  if (rows.length >= 18) for (const method of candidates) {
    let error = 0, count = 0, valid = true;
    for (let origin = rows.length - 6; origin < rows.length; origin++) {
      for (let target = origin; target < rows.length; target++) {
        const prediction = predict(daily.slice(0, origin), method, target - origin + 1) * rows[target].billedDays;
        if (!Number.isFinite(prediction) || prediction < 0) { valid = false; break; }
        error += Math.abs(prediction - Number(quantity(rows[target].consumptionKwh)) / 1000000); count++;
      }
      if (!valid) break;
    }
    if (valid) scores.push({ method, maeKwh: decimal(rounded(error / count)), predictions: count });
  }
  const selected = scores.reduce<Method>((best, score) => {
    const previous = scores.find(s => s.method === best);
    return !previous || quantity(score.maeKwh) < quantity(previous.maeKwh) ? score.method : best;
  }, 'MEAN_DAILY');
  const future: { month: string; baselineKwh: string; expansionKwh: string; predictedKwh: string; days: number }[] = [];
  const year = Math.floor(cutoff / 12);
  for (let index = cutoff + 1; index <= year * 12 + 11; index++) {
    const days = new Date(Date.UTC(year, index % 12 + 1, 0)).getUTCDate();
    const baseline = rounded(predict(daily, selected, index - cutoff) * days);
    const expansion = input.expansions.filter(e => monthIndex(e.startMonth) <= index && monthIndex(e.endMonth) >= index).reduce((n, e) => n + quantity(e.monthlyKwh), 0n);
    future.push({ month: monthName(index), baselineKwh: decimal(baseline), expansionKwh: decimal(expansion), predictedKwh: decimal(baseline + expansion), days });
  }
  const observed = rows.filter(r => Number(r.month.slice(0, 4)) === year).reduce((n, r) => n + quantity(r.consumptionKwh), 0n);
  return {
    formulaVersion: FORECAST_FORMULA_VERSION, status: 'PRELIMINARY' as const,
    organizationId: input.organizationId, customerId: input.customerId, unitId: input.unitId,
    asOfMonth: input.asOfMonth, method: selected, historyMonths: rows.length,
    actual: rows, future, scores, expansions: input.expansions,
    observedYearKwh: decimal(observed), futureKwh: decimal(future.reduce((n, r) => n + quantity(r.predictedKwh), 0n)),
    estimatedYearKwh: decimal(observed + future.reduce((n, r) => n + quantity(r.predictedKwh), 0n)),
    uncertainty: null, weatherApplied: false, demandApplied: false,
    qualifications: ['Normalização por dias faturados; previsão por dias de calendário. Conferir alinhamento dos períodos de leitura.', 'Sem ajuste climático, de demanda ou de emissões nesta versão.', 'Expansões são premissas documentadas; ganhos de carbono não reduzem consumo.', ...(rows.length < 18 ? ['Histórico insuficiente para seleção por teste cronológico; média diária preliminar.'] : [])],
    sourceCount: sourceKeys.size,
  };
}
