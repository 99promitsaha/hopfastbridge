import { env } from '../config/env.js';

/**
 * Native-token USD price lookup with an in-memory cache.
 *
 * Used to convert deBridge's `fixFee` (paid as `msg.value` in native wei) into
 * the USD figure we advertise to users. Without this, deBridge appears ~100x
 * cheaper than it actually is on small trades because the native protocol fee
 * never makes it into our displayed `feeUsd`.
 *
 * Provider waterfall (matches the frontend `priceService.ts`):
 *   1. CoinGecko with API key (if COINGECKO_API_KEY set)
 *   2. CoinMarketCap with API key (if CMC_API_KEY set)
 *   3. CoinGecko unkeyed (free tier) — last resort
 *
 * Cached for 5 minutes per chain — plenty fresh for quote pricing, and keeps
 * us well clear of rate limits on every tier.
 */

interface PriceEntry {
  usd: number;
  fetchedAt: number;
}

const CACHE = new Map<number, PriceEntry>();
const CACHE_TTL_MS = 5 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 5000;

// Map EVM chainId → (CoinGecko coin id, CMC ticker). Use CG ids rather than
// symbols because CG is more reliable keyed by id, and CMC's `symbol` lookup
// matches on ticker which is unique enough for native assets.
interface NativeAssetKeys {
  coingeckoId: string;
  cmcSymbol: string;
}

const NATIVE_KEYS_BY_CHAIN_ID: Record<number, NativeAssetKeys> = {
  1:    { coingeckoId: 'ethereum',                  cmcSymbol: 'ETH' },
  8453: { coingeckoId: 'ethereum',                  cmcSymbol: 'ETH' },
  56:   { coingeckoId: 'binancecoin',               cmcSymbol: 'BNB' },
  137:  { coingeckoId: 'polygon-ecosystem-token',   cmcSymbol: 'POL' },
};

function fetchWithTimeout(url: string, init: RequestInit = {}): Promise<Response> {
  return fetch(url, { ...init, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
}

// ── Provider 1 / 3: CoinGecko (keyed or free) ──
async function fetchViaCoinGecko(coingeckoId: string, apiKey: string | undefined): Promise<number | null> {
  const headers: Record<string, string> = {};
  if (apiKey) headers['x-cg-demo-api-key'] = apiKey;

  const res = await fetchWithTimeout(
    `https://api.coingecko.com/api/v3/simple/price?ids=${coingeckoId}&vs_currencies=usd`,
    { headers }
  );

  if (!res.ok) throw new Error(`CoinGecko ${res.status}`);

  const data = (await res.json()) as Record<string, { usd?: number }>;
  const price = data[coingeckoId]?.usd;
  return typeof price === 'number' && Number.isFinite(price) && price > 0 ? price : null;
}

// ── Provider 2: CoinMarketCap ──
async function fetchViaCMC(cmcSymbol: string, apiKey: string): Promise<number | null> {
  const res = await fetchWithTimeout(
    `https://pro-api.coinmarketcap.com/v1/cryptocurrency/quotes/latest?symbol=${cmcSymbol}&convert=USD`,
    { headers: { 'X-CMC_PRO_API_KEY': apiKey } }
  );

  if (!res.ok) throw new Error(`CMC ${res.status}`);

  const body = (await res.json()) as {
    data?: Record<string, { quote?: { USD?: { price?: number } } }>;
  };

  const price = body.data?.[cmcSymbol]?.quote?.USD?.price;
  return typeof price === 'number' && Number.isFinite(price) && price > 0 ? price : null;
}

/**
 * Fetch the USD price of the native token for a given EVM chainId.
 *
 * Runs the waterfall CG(key) → CMC → CG(free). Returns `null` only if the
 * chain is unsupported or every provider fails and there's no stale cache.
 * Callers should treat `null` as "unknown" and skip adding a phantom fee,
 * rather than erroring out.
 */
export async function getNativeUsdPrice(chainId: number): Promise<number | null> {
  const keys = NATIVE_KEYS_BY_CHAIN_ID[chainId];
  if (!keys) return null;

  const cached = CACHE.get(chainId);
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
    return cached.usd;
  }

  const attempt = async (fn: () => Promise<number | null>): Promise<number | null> => {
    try {
      const price = await fn();
      if (price !== null) {
        CACHE.set(chainId, { usd: price, fetchedAt: Date.now() });
        return price;
      }
    } catch {
      // swallow — fall through to next provider
    }
    return null;
  };

  if (env.COINGECKO_API_KEY) {
    const price = await attempt(() => fetchViaCoinGecko(keys.coingeckoId, env.COINGECKO_API_KEY));
    if (price !== null) return price;
  }

  if (env.CMC_API_KEY) {
    const price = await attempt(() => fetchViaCMC(keys.cmcSymbol, env.CMC_API_KEY!));
    if (price !== null) return price;
  }

  const free = await attempt(() => fetchViaCoinGecko(keys.coingeckoId, undefined));
  if (free !== null) return free;

  // Every provider failed — serve stale cache if we have one, else null.
  return cached?.usd ?? null;
}

/**
 * Convert a native-token amount (as a base-units string, i.e. wei) to USD
 * using the cached price. All EVM chains we support use 18 decimals for the
 * native, so we hard-code that here.
 */
export function nativeWeiToUsd(wei: string | undefined, usdPerNative: number | null): number {
  if (!wei || !usdPerNative) return 0;
  try {
    const weiBig = BigInt(wei);
    if (weiBig <= 0n) return 0;
    // Preserve precision: do the integer-millis scale, then divide.
    // (wei * priceMillis) / 1e18 / 1000  →  USD
    const priceMillis = BigInt(Math.round(usdPerNative * 1000));
    const usdMillis = (weiBig * priceMillis) / 10n ** 18n;
    return Number(usdMillis) / 1000;
  } catch {
    return 0;
  }
}
