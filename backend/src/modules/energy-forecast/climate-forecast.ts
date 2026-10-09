import {decimal, monthIndex, quantity, type ForecastInput, calculateConsumptionForecast} from './consumption-forecast';

type Forecast = ReturnType<typeof calculateConsumptionForecast>;
export type ClimateHistory = {
  provider: 'NASA_POWER'; parameter: string; unit: string; timeStandard: string;
  sourceHash: string; from: string; to: string;
  monthly: {month: string; temperatureC: number | null; validDays: number; expectedDays: number}[];
};
type Model = {coefficients: number[]; temperatureCenter: number; temperatureScale: number};
const dot = (a: number[], b: number[]) => a.reduce((sum, v, i) => sum + v * b[i], 0);
const daysInMonth = (m: string) => new Date(Date.UTC(Number(m.slice(0, 4)), Number(m.slice(5)), 0)).getUTCDate();
const features = (i: number, month: string, temperature: number, model: Pick<Model, 'temperatureCenter' | 'temperatureScale'>, climate: boolean) => {
  const phase = (Number(month.slice(5)) - 1) * 2 * Math.PI / 12;
  return [1, i / 12, Math.sin(phase), Math.cos(phase), ...(climate ? [(temperature - model.temperatureCenter) / model.temperatureScale] : [])];
};

// Reorthogonalized QR avoids squaring the condition number through normal equations.
function fit(months: string[], daily: number[], temperatures: number[], climate: boolean): Model | null {
  const center = temperatures.reduce((sum, t) => sum + t, 0) / temperatures.length;
  const deviation = Math.sqrt(temperatures.reduce((sum, t) => sum + (t - center) ** 2, 0) / temperatures.length);
  if (climate && deviation < 0.1) return null;
  const model = {temperatureCenter: center, temperatureScale: deviation || 1};
  const matrix = months.map((m, i) => features(i, m, temperatures[i], model, climate));
  const size = matrix[0].length, q: number[][] = [], r = Array.from({length: size}, () => Array(size).fill(0) as number[]);
  for (let j = 0; j < size; j++) {
    const column = matrix.map(row => row[j]), originalNorm = Math.sqrt(dot(column, column));
    for (let pass = 0; pass < 2; pass++) for (let k = 0; k < j; k++) {
      const projection = dot(q[k], column); r[k][j] += projection;
      column.forEach((v, i) => {column[i] = v - projection * q[k][i];});
    }
    const norm = Math.sqrt(dot(column, column));
    if (!Number.isFinite(norm) || norm < Math.max(1, originalNorm) * 1e-7) return null;
    r[j][j] = norm; q.push(column.map(v => v / norm));
  }
  const coefficients = Array(size).fill(0) as number[], rhs = q.map(column => dot(column, daily));
  for (let j = size - 1; j >= 0; j--) {
    coefficients[j] = (rhs[j] - r[j].slice(j + 1).reduce((sum, v, k) => sum + v * coefficients[j + k + 1], 0)) / r[j][j];
  }
  return coefficients.every(Number.isFinite) ? {...model, coefficients} : null;
}
const predict = (model: Model, index: number, month: string, temperature: number, climate: boolean) => dot(model.coefficients, features(index, month, temperature, model, climate));
const scaled = (value: number) => {
  const n = Math.round(value * 1e6);
  if (!Number.isFinite(value) || value < 0 || !Number.isSafeInteger(n)) throw Error('CLIMATE_PREDICTION_INVALID');
  return decimal(BigInt(n));
};

/** Only changes a new preliminary snapshot. No I/O, access or publication decisions. */
export function applyClimateForecast(input: ForecastInput, base: Forecast, weather: ClimateHistory) {
  if (['organizationId', 'customerId', 'unitId', 'asOfMonth'].some(k => input[k as keyof ForecastInput] !== base[k as keyof Forecast])) throw Error('CLIMATE_SCOPE_INVALID');
  const rejected = (reason: string, comparison: unknown = null) => ({...base, climateAssessment: {version: 'climate-scenario/1.0', applied: false, reason, comparison},
    qualifications: [...base.qualifications, `Ajuste climático não aplicado: ${reason}.`]});
  const rows = base.actual, months = rows.map(r => r.month);
  if (rows.length < 30) return rejected('são necessários 30 a 36 meses para treinamento de 24 meses e seis origens de teste');
  if (base.future.length > 6) return rejected('horizonte até dezembro excede os seis meses avaliados pelo teste cronológico');
  if (weather.provider !== 'NASA_POWER' || weather.parameter !== 'T2M' || weather.unit !== '°C' || weather.timeStandard !== 'UTC' || !/^[a-f0-9]{64}$/.test(weather.sourceHash)) return rejected('metadados meteorológicos inválidos');
  if (weather.from !== months[0] + '-01' || weather.to !== base.asOfMonth + '-' + String(daysInMonth(base.asOfMonth)).padStart(2, '0')) return rejected('período meteorológico incompatível com o histórico');
  if (rows.some(r => r.billedDays !== daysInMonth(r.month))) return rejected('dias faturados diferem do mês civil; conciliar os períodos de leitura antes de aplicar temperatura mensal');
  const byMonth = new Map(weather.monthly.map(m => [m.month, m]));
  if (byMonth.size !== weather.monthly.length || months.some(m => {
    const row = byMonth.get(m), days = daysInMonth(m);
    return !row || row.validDays !== days || row.expectedDays !== days || row.temperatureC === null || !Number.isFinite(row.temperatureC) || row.temperatureC < -90 || row.temperatureC > 65;
  })) return rejected('histórico meteorológico incompleto ou duplicado; ausência não representa zero');
  const temperatures = months.map(m => byMonth.get(m)!.temperatureC!), daily = rows.map(r => Number(quantity(r.consumptionKwh)) / 1e6 / r.billedDays);
  // Both candidates use the SAME chronological targets, trained without future consumption or weather.
  // Future temperature is last year's same-month value, a scenario, not an observed future value.
  const origins: {origin: string; climateMaeKwh: number; baselineMaeKwh: number; predictions: number}[] = [];
  let climateError = 0, baselineError = 0, count = 0;
  for (let origin = rows.length - 6; origin < rows.length; origin++) {
    const model = fit(months.slice(0, origin), daily.slice(0, origin), temperatures.slice(0, origin), true);
    const control = fit(months.slice(0, origin), daily.slice(0, origin), temperatures.slice(0, origin), false);
    if (!model || !control) return rejected('temperatura não identificável separadamente de tendência e sazonalidade');
    let climateSum = 0, baselineSum = 0;
    for (let target = origin; target < rows.length; target++) {
      const temperature = temperatures[target - 12];
      const climate = predict(model, target, months[target], temperature, true) * rows[target].billedDays;
      const baseline = predict(control, target, months[target], temperature, false) * rows[target].billedDays;
      try {scaled(climate); scaled(baseline);} catch {return rejected('previsões inválidas no teste cronológico');}
      const actual = Number(quantity(rows[target].consumptionKwh)) / 1e6;
      climateSum += Math.abs(climate - actual); baselineSum += Math.abs(baseline - actual); count++;
    }
    const predictions = rows.length - origin;
    origins.push({origin: months[origin - 1], climateMaeKwh: climateSum / predictions, baselineMaeKwh: baselineSum / predictions, predictions});
    climateError += climateSum; baselineError += baselineSum;
  }
  const baselineScore = Math.min(baselineError / count, ...base.scores.map(s => Number(s.maeKwh)));
  const climateScore = climateError / count;
  const comparison = {climateMaeKwh: scaled(climateScore), controlMaeKwh: scaled(baselineError / count), bestBaselineMaeKwh: scaled(baselineScore), predictions: count,
    improvementPercent: baselineScore > 0 ? Number(((baselineScore - climateScore) / baselineScore * 100).toFixed(6)) : null,
    minimumImprovementPercent: 10, origins: origins.map(o => ({...o, climateMaeKwh: scaled(o.climateMaeKwh), baselineMaeKwh: scaled(o.baselineMaeKwh)}))};
  if (baselineScore <= 0 || climateScore >= baselineScore * 0.9 || origins.filter(o => o.climateMaeKwh < o.baselineMaeKwh).length < 4) return rejected('ganho fora da amostra insuficiente para substituir o modelo sem clima', comparison);
  const model = fit(months, daily, temperatures, true)!;
  const scenarios: {month: string; sourceMonth: string; temperatureC: number}[] = [];
  let future: Forecast['future'];
  try {
    future = base.future.map(row => {
      const sourceIndex = monthIndex(row.month) - 12 - monthIndex(months[0]);
      const temperature = temperatures[sourceIndex];
      scenarios.push({month: row.month, sourceMonth: months[sourceIndex], temperatureC: temperature});
      const baselineKwh = scaled(predict(model, monthIndex(row.month) - monthIndex(months[0]), row.month, temperature, true) * row.days);
      const {averageBasis,averageSourceMonths,...original}=row;
      return {...original, baselineKwh, predictedKwh: decimal(quantity(baselineKwh) + quantity(row.expansionKwh))};
    });
  } catch {return rejected('previsão futura inválida; revisar histórico e cenário', comparison);}
  const futureTotal = future.reduce((sum, r) => sum + quantity(r.predictedKwh), 0n);
  return {...base, formulaVersion: 'consumption-forecast/1.3', method: 'CLIMATE_TREND_SEASONAL_DAILY', weatherApplied: true,
    future, futureKwh: decimal(futureTotal), estimatedYearKwh: decimal(quantity(base.observedYearKwh) + futureTotal),
    climateAssessment: {version: 'climate-scenario/1.0', applied: true, reason: 'ganho cronológico acima do limiar', comparison, sourceHash: weather.sourceHash,
      coefficients: model.coefficients, temperatureCenter: model.temperatureCenter, temperatureScale: model.temperatureScale,
      scenario: 'SAME_MONTH_PREVIOUS_YEAR', scenarios, testedMaxHorizonMonths: 6},
    qualifications: [...base.qualifications.filter(q => !q.startsWith('Sem ajuste climático')),
      'Temperatura regional NASA POWER; competência mensal e dias civis são aproximações dos períodos de leitura, que exigem conferência.',
      'Cenário climático: temperatura do mesmo mês do ano anterior; não é previsão meteorológica nem normal climatológica.',
      `Teste cronológico: MAE climático ${comparison.climateMaeKwh} kWh; melhor referência sem clima ${comparison.bestBaselineMaeKwh} kWh; ganho ${comparison.improvementPercent}% em ${count} previsões de seis origens. Política: ganho superior a 10% e melhora em pelo menos quatro origens.`,
      'Teste cronológico de até seis meses; horizontes maiores até dezembro não têm validação equivalente. Sem intervalo de previsão calibrado.',
      'Ajuste climático estatístico não comprova causalidade. Demanda e emissões não alteram consumo nesta versão.']};
}
