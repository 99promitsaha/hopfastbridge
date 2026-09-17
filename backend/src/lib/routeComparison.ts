export type Provider = 'lifi' | 'squid' | 'debridge' | 'relay';
export const providers: Provider[] = ['lifi', 'squid', 'debridge', 'relay'];
export interface ComparableQuote {
  id: string; dstAmount: string; dstAmountMin?: string; feeUsd: string;
  duration: { estimated: string | null }; userSteps: unknown[];
}
export interface QuoteResponse { provider: string; quotes: ComparableQuote[] }
export interface RouteLimits { maxFeeUsd?: number; maxEtaSeconds?: number; minDestinationAmount?: string }

/** Compare output in token base units without converting it to floating point. */
export async function compareRoutes(
  request: (provider: Provider) => Promise<QuoteResponse>,
  requested: Provider[], limits: RouteLimits
) {
  const results = await Promise.allSettled(requested.map(request));
  const routes: Array<{ provider: Provider; quote: ComparableQuote; eligible: boolean; reasons: string[] }> = [];
  const unavailable: Array<{ provider: Provider; reason: string }> = [];
  results.forEach((result, index) => {
    const provider = requested[index];
    if (result.status === 'rejected') {
      unavailable.push({ provider, reason: 'Provider could not quote this route. Check chain support and provider configuration.' });
      return;
    }
    for (const quote of result.value.quotes) {
      if (!/^\d+$/.test(quote.dstAmount) || BigInt(quote.dstAmount) <= 0n) continue;
      const reasons: string[] = [];
      const fee = quote.feeUsd.trim() ? Number(quote.feeUsd) : NaN;
      const eta = quote.duration.estimated == null ? NaN : Number(quote.duration.estimated) / 1000;
      if (!Number.isFinite(fee) || fee < 0) reasons.push('Fee estimate unavailable.');
      else if (limits.maxFeeUsd != null && fee > limits.maxFeeUsd) reasons.push('Exceeds fee budget.');
      if (limits.maxEtaSeconds != null && (!Number.isFinite(eta) || eta > limits.maxEtaSeconds)) reasons.push('Exceeds duration limit or duration is unknown.');
      const minimum = quote.dstAmountMin;
      if (limits.minDestinationAmount != null && (!minimum || !/^\d+$/.test(minimum) || BigInt(minimum) < BigInt(limits.minDestinationAmount))) reasons.push('Guaranteed output is below the requested minimum or unknown.');
      if (!quote.userSteps.some(step => {
        const tx = (step as { transaction?: { to?: string; data?: string } } | null)?.transaction;
        return tx && /^0x[\da-fA-F]{40}$/.test(tx.to ?? '') && /^0x(?:[\da-fA-F]{2})*$/.test(tx.data ?? '');
      })) reasons.push('No executable transaction.');
      routes.push({ provider, quote, eligible: reasons.length === 0, reasons });
    }
    if (!result.value.quotes.length) unavailable.push({ provider, reason: 'No route returned.' });
  });
  routes.sort((a, b) => {
    if (a.eligible !== b.eligible) return a.eligible ? -1 : 1;
    const x = BigInt(a.quote.dstAmount), y = BigInt(b.quote.dstAmount);
    return x === y ? Number(a.quote.feeUsd) - Number(b.quote.feeUsd) : x > y ? -1 : 1;
  });
  return { routes, unavailable, best: routes.find(route => route.eligible) ?? null, ranking: 'Highest destination amount, then lowest estimated fees; only routes satisfying all limits are eligible.' };
}
