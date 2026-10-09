/** Chronological fallback policy. Values are daily consumption, never future readings. */
export const MONTHLY_AVERAGE_VERSION = 'same-month-average/1.0';
export const SAME_MONTH_MINIMUM = 2;
export function monthlyAverage(values: number[], months: string[], target: string) {
 if (!values.length || values.length !== months.length) throw Error('AVERAGE_HISTORY_INVALID');
 const indexes = months.map((month, i) => month.slice(5) === target.slice(5) ? i : -1).filter(i => i >= 0);
 const sameMonth = indexes.length >= SAME_MONTH_MINIMUM;
 const selected = sameMonth ? indexes.map(i => values[i]) : values;
 return {daily: selected.reduce((sum, value) => sum + value, 0) / selected.length,
  basis: sameMonth ? 'SAME_MONTH' as const : 'AVAILABLE_PERIOD' as const,
  sourceMonths: sameMonth ? indexes.map(i => months[i]) : [...months]};
}
