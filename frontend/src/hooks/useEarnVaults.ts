import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchVaults } from '../services/earnService';
import type { EarnVault, EarnFilters } from '../types';

const ASSET_FAMILIES: Record<string, string[]> = {
  ETH_FAMILY: ['ETH', 'WETH', 'STETH', 'WSTETH'],
  BTC_FAMILY: ['BTC', 'WBTC', 'CBBTC', 'TBTC', 'BTCB'],
};

const STABLECOIN_SYMBOLS = ['USDC', 'USDC.E', 'USDCE', 'USDT', 'DAI', 'XDAI', 'BUSD', 'USDS', 'PYUSD', 'FRAX', 'LUSD', 'GHO', 'CUSD', 'EUSD'];

/**
 * Determines what asset param to send to the API.
 * - Family filters (ETH_FAMILY, BTC_FAMILY) and stablecoin toggle need client-side
 *   filtering, so we don't send an asset to the API (returns all vaults).
 * - Single-asset filters (DAI, USDC, etc.) go straight to the API.
 */
function resolveApiAsset(filters: EarnFilters): string | undefined {
  if (filters.asset && filters.asset in ASSET_FAMILIES) return undefined;
  if (filters.asset) return filters.asset;
  if (filters.stablecoinOnly) return undefined;
  return undefined;
}

/** Check if two filter states would produce the same API call */
function sameApiCall(a: EarnFilters, b: EarnFilters): boolean {
  return a.chainId === b.chainId
    && a.sortBy === b.sortBy
    && a.protocol === b.protocol
    && resolveApiAsset(a) === resolveApiAsset(b);
}

export function useEarnVaults() {
  const [allVaults, setAllVaults] = useState<EarnVault[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [total, setTotal] = useState(0);
  const cursorRef = useRef<string | null>(null);
  const hasMoreRef = useRef(true);
  const loadedRef = useRef(false);
  const abortRef = useRef<AbortController | null>(null);

  const [filters, setFilters] = useState<EarnFilters>({
    chainId: null,
    stablecoinOnly: true,
    sortBy: 'apy',
    search: '',
    protocol: null,
    asset: null,
  });

  const loadVaults = useCallback(async (
    currentFilters: EarnFilters,
    reset: boolean,
  ) => {
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;

    setLoading(true);
    setError('');

    try {
      const cursor = reset ? undefined : (cursorRef.current ?? undefined);

      const res = await fetchVaults({
        chainId: currentFilters.chainId ?? undefined,
        sortBy: currentFilters.sortBy,
        asset: resolveApiAsset(currentFilters),
        protocol: currentFilters.protocol ?? undefined,
        minTvlUsd: 10_000,
        cursor,
        limit: 50,
      });

      if (ctrl.signal.aborted) return;

      setTotal(res.total);
      cursorRef.current = res.nextCursor;
      hasMoreRef.current = res.nextCursor != null && res.data.length > 0;

      if (reset) {
        setAllVaults(res.data);
      } else {
        setAllVaults((prev) => [...prev, ...res.data]);
      }
    } catch (err) {
      if (ctrl.signal.aborted) return;
      setError(err instanceof Error ? err.message : 'Failed to load vaults');
    } finally {
      if (!ctrl.signal.aborted) setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!loadedRef.current) {
      loadedRef.current = true;
      loadVaults(filters, true);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const updateFilters = useCallback((patch: Partial<EarnFilters>) => {
    setFilters((prev) => {
      const next = { ...prev, ...patch };

      // Clear asset filter when stablecoins toggle is turned on
      if (patch.stablecoinOnly && next.stablecoinOnly && next.asset) {
        next.asset = null;
      }
      // Turn off stablecoins when a non-stablecoin asset filter is picked
      if (patch.asset !== undefined && patch.asset != null) {
        if (patch.asset in ASSET_FAMILIES || !STABLECOIN_SYMBOLS.includes(patch.asset.toUpperCase())) {
          next.stablecoinOnly = false;
        }
      }

      // Only hit the API if the server-side params actually changed
      if (!sameApiCall(prev, next)) {
        cursorRef.current = null;
        hasMoreRef.current = true;
        loadVaults(next, true);
      }

      return next;
    });
  }, [loadVaults]);

  const loadMore = useCallback(() => {
    if (hasMoreRef.current && !loading) {
      loadVaults(filters, false);
    }
  }, [loading, filters, loadVaults]);

  // Client-side filtering for families and stablecoins
  const familySymbols = filters.asset && ASSET_FAMILIES[filters.asset];
  const stablecoinFilter = !filters.asset && filters.stablecoinOnly;

  const filteredVaults = allVaults.filter((v) => {
    if (!v.isTransactional) return false;
    if (familySymbols) {
      const hasMatch = v.underlyingTokens.some((t) =>
        familySymbols.includes(t.symbol.toUpperCase())
      );
      if (!hasMatch) return false;
    }
    if (stablecoinFilter) {
      const hasStable = v.underlyingTokens.some((t) =>
        STABLECOIN_SYMBOLS.includes(t.symbol.toUpperCase())
      );
      if (!hasStable) return false;
    }
    if (filters.search) {
      const q = filters.search.toLowerCase();
      const matchesName = v.name.toLowerCase().includes(q);
      const matchesProtocol = v.protocol.name.toLowerCase().includes(q);
      const matchesToken = v.underlyingTokens.some((t) => t.symbol.toLowerCase().includes(q));
      if (!matchesName && !matchesProtocol && !matchesToken) return false;
    }
    return true;
  });

  // TVL sort for client-side filtered results so there's a natural mix
  if (stablecoinFilter || familySymbols) {
    filteredVaults.sort((a, b) => parseFloat(b.analytics?.tvl?.usd ?? '0') - parseFloat(a.analytics?.tvl?.usd ?? '0'));
  }

  return {
    vaults: filteredVaults,
    allCount: total,
    loading,
    error,
    filters,
    updateFilters,
    loadMore,
    hasMore: hasMoreRef.current,
  };
}
