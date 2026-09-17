import { API_BASE_URL } from '../constants';

let inflight: Promise<Record<string, number>> | null = null;
let cached: Record<string, number> = {};
let fetchedAt = 0;
export async function getTokenPrices(): Promise<Record<string, number>> {
  if (Date.now() - fetchedAt < 30000) return cached;
  if (!inflight) {
    inflight = fetch(`${API_BASE_URL}/prices`, { signal: AbortSignal.timeout(20000) })
      .then(async response => {
        if (!response.ok) throw new Error('Price service unavailable.');
        const body = await response.json() as { prices: Record<string, number> };
        cached = body.prices; fetchedAt = Date.now(); return cached;
      }).catch(() => cached).finally(() => { inflight = null; });
  }
  return inflight;
}

/**
 * Get the USD price and value for a specific token amount.
 */
export function computeUsdValue(
  prices: Record<string, number>,
  symbol: string,
  amount: string
): { price: number; value: number } | null {
  const price = prices[symbol];
  if (typeof price !== 'number') return null;

  const numAmount = Number(amount);
  if (!Number.isFinite(numAmount) || numAmount <= 0) return null;

  return { price, value: price * numAmount };
}
