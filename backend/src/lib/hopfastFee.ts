interface FeeCost {
  amountUSD?: string; percentage?: string; included?: boolean;
  feeSplit?: { integratorFee?: string };
  token?: { decimals?: number; priceUSD?: string };
}
interface FeeStep { type?: string; tool?: string; estimate?: { feeCosts?: FeeCost[] } }

/** Display a portion of the included fee; never add it to transaction totals. */
export function quotedHopfastFeeUsd(quote: { includedSteps?: FeeStep[] }, rate: number): string | null {
  if (rate === 0) return '0';
  const fees = (quote.includedSteps ?? [])
    .filter(step => step.type === 'protocol' && step.tool === 'feeCollection')
    .flatMap(step => step.estimate?.feeCosts ?? [])
    .filter(fee => fee.included === true && fee.percentage != null &&
      (Number(fee.percentage) === rate || Math.abs(Number(fee.percentage) - rate - 0.0025) < 1e-12));
  if (fees.length !== 1 || !/^\d+(?:\.\d+)?$/.test(fees[0].amountUSD ?? '')) return null;
  const fee = fees[0];
  // Prefer the quote's explicit integrator token amount and quoted token price.
  // This avoids assigning platform fees to Hopfast or inheriting rounded USD totals.
  const own = fee.feeSplit?.integratorFee;
  const price = fee.token?.priceUSD;
  const decimals = fee.token?.decimals;
  if (/^\d+$/.test(own ?? '') && /^\d+(?:\.\d+)?$/.test(price ?? '') && Number.isInteger(decimals) && decimals! >= 0 && decimals! <= 18) {
    const [whole, fraction = ''] = price!.split('.');
    const value = BigInt(own!) * BigInt(whole + fraction);
    const places = decimals! + fraction.length;
    if (!places) return value.toString();
    const digits = value.toString().padStart(places + 1, '0');
    return (digits.slice(0, -places) + '.' + digits.slice(-places)).replace(/0+$/, '').replace(/\.$/, '');
  }
  if (Number(fee.percentage) === rate) return fee.amountUSD!;
  // LI.FI can combine its 25-bps base fee and our commission. Allocate the
  // provider-reported USD amount proportionally, using decimal integer arithmetic.
  const [whole, fraction = ''] = fee.amountUSD!.split('.');
  const scale = 10n ** BigInt(fraction.length);
  const amount = BigInt(whole + fraction);
  const commission = BigInt(Math.round(rate * 1e9));
  const combined = BigInt(Math.round(Number(fee.percentage) * 1e9));
  const precision = 10n ** 18n;
  const result = amount * commission * precision / (scale * combined);
  const digits = result.toString().padStart(19, '0');
  return (digits.slice(0, -18) + '.' + digits.slice(-18)).replace(/0+$/, '').replace(/\.$/, '');
}
