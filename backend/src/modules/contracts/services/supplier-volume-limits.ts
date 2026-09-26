/** Percentages have different bases: minimum is a share; upper tolerance is added to 100%. */
export function supplierVolumeLimits(volume: bigint, minimumPercent: unknown, maximumTolerancePercent: unknown) {
 const percent = (value: unknown): bigint => {
  const text = String(value);
  if (!/^(0|[1-9][0-9]{0,3})([.][0-9]{1,4})?$/.test(text)) throw new Error('Percentual contratual inválido.');
  const [whole, fraction = ''] = text.split('.');
  const result = BigInt(whole) * 10000n + BigInt(fraction.padEnd(4, '0'));
  if (result > 99990000n) throw new Error('Percentual contratual inválido.');
  return result;
 };
 const minimum = percent(minimumPercent), tolerance = percent(maximumTolerancePercent), maximum = 1000000n + tolerance;
 if (volume < 0n || minimum > maximum) throw new Error('Limites mínimo e máximo inválidos.');
 return { min: volume * minimum / 1000000n, max: volume * maximum / 1000000n };
}
