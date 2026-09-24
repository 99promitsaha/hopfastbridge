export function parseUnits(amount: string, decimals: number): bigint {
  const sanitized = amount.trim();

  if (!/^\d*\.?\d*$/.test(sanitized) || !sanitized) {
    throw new Error('Enter a valid amount.');
  }

  const [whole, fraction = ''] = sanitized.split('.');
  const normalizedWhole = whole || '0';
  const normalizedFraction = fraction.slice(0, decimals).padEnd(decimals, '0');

  const wholeValue = BigInt(normalizedWhole) * 10n ** BigInt(decimals);
  const fractionValue = normalizedFraction ? BigInt(normalizedFraction) : 0n;

  return wholeValue + fractionValue;
}

export function formatUnits(value: bigint, decimals: number, precision = 6): string {
  const sign = value < 0n ? '-' : '';
  const absolute = value < 0n ? -value : value;

  const divisor = 10n ** BigInt(decimals);
  const whole = absolute / divisor;
  const fraction = (absolute % divisor).toString().padStart(decimals, '0');

  const trimmed = fraction.slice(0, precision).replace(/0+$/, '');
  return trimmed ? `${sign}${whole.toString()}.${trimmed}` : `${sign}${whole.toString()}`;
}

export function formatUsd(value: number): string {
  if (value > 0 && value < 0.001) return '<$0.001';
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 3
  }).format(value);
}

export function formatDisplayAmount(value: string | number, places = 3): string {
  const numeric = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(numeric)) return String(value);
  if (numeric > 0 && numeric < 10 ** -places)
    return `<${(10 ** -places).toFixed(places)}`;
  return numeric.toFixed(places).replace(/\.?0+$/, '');
}
