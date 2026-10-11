import type { QuoteResult } from '../services/quoteService';

function amountParts(amount: string): [string, string] | null {
  return /^\d+(?:\.\d+)?$/.test(amount)
    ? [amount.split('.')[0], amount.split('.')[1] ?? '']
    : null;
}

/** Quotes in one comparison have the same input and destination asset.
 * Compare exact received amounts, not provider fee categories or rounded UI text.
 */
export function compareQuotes(a: QuoteResult, b: QuoteResult): number {
  const left = amountParts(a.destinationAmount);
  const right = amountParts(b.destinationAmount);
  if (!left || !right) return left ? -1 : right ? 1 : 0;
  const precision = Math.max(left[1].length, right[1].length);
  const leftAmount = BigInt(left[0] + left[1].padEnd(precision, '0'));
  const rightAmount = BigInt(right[0] + right[1].padEnd(precision, '0'));
  if (leftAmount !== rightAmount) return leftAmount > rightAmount ? -1 : 1;

  const fee = (q: QuoteResult) =>
    Number.isFinite(q.feeUsd) && q.feeUsd >= 0 ? q.feeUsd : Infinity;
  const leftFee = fee(a), rightFee = fee(b);
  return leftFee === rightFee ? 0 : leftFee < rightFee ? -1 : 1;
}

export function getBestQuote(quotes: QuoteResult[]): QuoteResult | null {
  return quotes.reduce<QuoteResult | null>(
    (best, quote) => !best || compareQuotes(quote, best) < 0 ? quote : best,
    null
  );
}
