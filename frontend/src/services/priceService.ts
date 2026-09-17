/**
 * Token price fetcher with 3-tier fallback:
 *   1. CoinGecko (with API key) — primary
 *   2. CoinMarketCap (with API key) — fallback
 *   3. CoinGecko (no key, free tier) — last resort
 *
 * Caches prices for 30 seconds. Deduplicates concurrent requests.
 */

const CG_API_KEY = (import.meta.env.VITE_COINGECKO_API_KEY ?? '').trim();
const CMC_API_KEY = (import.meta.env.VITE_CMC_API_KEY ?? '').trim();

// ── CoinGecko symbol → id mapping ──
const SYMBOL_TO_CG_ID: Record<string, string> = {
  ETH:     'ethereum',
  WETH:    'weth',
  BNB:     'binancecoin',
  USDC:    'usd-coin',
  USDT:    'tether',
  DAI:     'dai',
  WBTC:    'wrapped-bitcoin',
  BTCB:    'bitcoin',
  cbBTC:   'coinbase-wrapped-btc',
  POL:     'polygon-ecosystem-token',
  MON:     'monad',
  WMON:    'wrapped-monad',
  VIRTUAL: 'virtual-protocol',
  UNI:     'uniswap',
  AAVE:    'aave',
  XAUT:    'tether-gold',
  AERO:    'aerodrome-finance',
};

const ALL_SYMBOLS = Object.keys(SYMBOL_TO_CG_ID);

// ── Cache ──
interface PriceCache {
  prices: Record<string, number>;
  timestamp: number;
}

let cache: PriceCache | null = null;
const CACHE_TTL = 30_000;
let inflightPromise: Promise<Record<string, number>> | null = null;

// ── Provider 1: CoinGecko ──
async function fetchViaCoinGecko(apiKey: string): Promise<Record<string, number>> {
  const ids = [...new Set(Object.values(SYMBOL_TO_CG_ID))].join(',');
  const headers: Record<string, string> = {};
  if (apiKey) headers['x-cg-demo-api-key'] = apiKey;

  const res = await fetch(
    `https://api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=usd`,
    { headers, signal: AbortSignal.timeout(5000) }
  );

  if (!res.ok) throw new Error(`CoinGecko ${res.status}`);

  const data = (await res.json()) as Record<string, { usd?: number }>;
  const prices: Record<string, number> = {};

  for (const [symbol, cgId] of Object.entries(SYMBOL_TO_CG_ID)) {
    const price = data[cgId]?.usd;
    if (typeof price === 'number' && Number.isFinite(price)) {
      prices[symbol] = price;
    }
  }

  return prices;
}

// ── Provider 2: CoinMarketCap ──
async function fetchViaCMC(apiKey: string): Promise<Record<string, number>> {
  const symbols = ALL_SYMBOLS.join(',');

  const res = await fetch(
    `https://pro-api.coinmarketcap.com/v1/cryptocurrency/quotes/latest?symbol=${symbols}&convert=USD`,
    {
      headers: { 'X-CMC_PRO_API_KEY': apiKey },
      signal: AbortSignal.timeout(5000),
    }
  );

  if (!res.ok) throw new Error(`CMC ${res.status}`);

  const body = (await res.json()) as {
    data?: Record<string, { quote?: { USD?: { price?: number } } }>;
  };

  const prices: Record<string, number> = {};

  if (body.data) {
    for (const symbol of ALL_SYMBOLS) {
      const price = body.data[symbol]?.quote?.USD?.price;
      if (typeof price === 'number' && Number.isFinite(price)) {
        prices[symbol] = price;
      }
    }
  }

  return prices;
}

// ── Waterfall: CoinGecko (keyed) → CMC → CoinGecko (free) ──
async function fetchAllPrices(): Promise<Record<string, number>> {
  if (CG_API_KEY) {
    try {
      const prices = await fetchViaCoinGecko(CG_API_KEY);
      if (Object.keys(prices).length > 0) {
        cache = { prices, timestamp: Date.now() };
        return prices;
      }
    } catch { /* fall through */ }
  }

  if (CMC_API_KEY) {
    try {
      const prices = await fetchViaCMC(CMC_API_KEY);
      if (Object.keys(prices).length > 0) {
        cache = { prices, timestamp: Date.now() };
        return prices;
      }
    } catch { /* fall through */ }
  }

  try {
    const prices = await fetchViaCoinGecko('');
    if (Object.keys(prices).length > 0) {
      cache = { prices, timestamp: Date.now() };
      return prices;
    }
  } catch { /* fall through */ }

  return cache?.prices ?? {};
}

/**
 * Get USD prices for all supported tokens.
 * Returns a map of symbol → USD price.
 * Deduplicates concurrent requests and caches for 30s.
 */
export async function getTokenPrices(): Promise<Record<string, number>> {
  if (cache && Date.now() - cache.timestamp < CACHE_TTL) {
    return cache.prices;
  }

  if (!inflightPromise) {
    inflightPromise = fetchAllPrices().finally(() => {
      inflightPromise = null;
    });
  }

  return inflightPromise;
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
