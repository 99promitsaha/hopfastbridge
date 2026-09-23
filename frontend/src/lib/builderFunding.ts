import { parseUnits, formatUnits } from './amount';

export function fundingAmounts(amount: string, basisPoints: 250) {
  try {
    if (!/^\d+(\.\d{1,6})?$/.test(amount)) return null;
    const units = parseUnits(amount, 6);
    if (units <= 0n || units > 1_000_000n * 1_000_000n) return null;
    const fee = (units * BigInt(basisPoints) + 9999n) / 10000n;
    if (fee >= units) return null;
    return {
      amount: formatUnits(units - fee, 6, 6),
      fee: formatUnits(fee, 6, 6),
      total: formatUnits(units, 6, 6),
    };
  } catch {
    return null;
  }
}
