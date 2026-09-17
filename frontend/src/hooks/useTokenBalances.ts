import { useEffect, useMemo, useState } from 'react';
import { CHAIN_BY_KEY, type ChainKey } from '../lib/chains';
import { formatUnits } from '../lib/amount';
import { fetchSingleTokenBalance, fetchTokenBalancesForChain } from '../services/balanceService';
import { makeBalanceKey } from '../lib/swap';

interface TokenDef {
  address: string;
  symbol: string;
  decimals: number;
}

export function useTokenBalances(
  activeWalletAddress: string | null,
  fromChain: ChainKey,
  selectedFromToken: TokenDef
) {
  const [tokenBalances, setTokenBalances] = useState<Record<string, bigint>>({});
  const [isRefreshingBalances, setIsRefreshingBalances] = useState(false);
  const [balanceRefreshTick, setBalanceRefreshTick] = useState(0);
  const [balanceError, setBalanceError] = useState('');

  useEffect(() => {
    if (!activeWalletAddress) {
      setBalanceError('');
      return;
    }

    let cancelled = false;

    const refreshBalances = async () => {
      try {
        setIsRefreshingBalances(true);
        setBalanceError('');

        const balances = await fetchTokenBalancesForChain(
          fromChain,
          activeWalletAddress,
          CHAIN_BY_KEY[fromChain].tokens
        );

        if (cancelled) return;

        setTokenBalances((prev) => {
          const next = { ...prev };
          for (const [tokenAddress, rawBalance] of Object.entries(balances)) {
            next[makeBalanceKey(fromChain, tokenAddress)] = rawBalance;
          }
          return next;
        });
      } catch (caughtError) {
        if (cancelled) return;
        setBalanceError(caughtError instanceof Error ? caughtError.message : 'Failed to fetch wallet balances.');
      } finally {
        if (!cancelled) {
          setIsRefreshingBalances(false);
        }
      }
    };

    refreshBalances().catch(() => {});

    return () => { cancelled = true; };
  }, [activeWalletAddress, fromChain, balanceRefreshTick]);

  // Ensure selected token balance is fetched with RPC fallback/retry
  useEffect(() => {
    if (!activeWalletAddress) return;

    let cancelled = false;

    const refreshSelectedTokenBalance = async () => {
      const balance = await fetchSingleTokenBalance(
        fromChain,
        activeWalletAddress,
        selectedFromToken
      );

      if (cancelled) return;

      if (balance == null) {
        setBalanceError(`Could not load ${selectedFromToken.symbol} balance right now.`);
        return;
      }

      setTokenBalances((prev) => ({
        ...prev,
        [makeBalanceKey(fromChain, selectedFromToken.address)]: balance
      }));
      setBalanceError('');
    };

    refreshSelectedTokenBalance().catch(() => {});

    return () => { cancelled = true; };
  }, [activeWalletAddress, fromChain, selectedFromToken.address, selectedFromToken.symbol]);

  // Build formatted balance map for source chain token selector
  const formattedSourceBalances = useMemo(() => {
    const fromTokenOptions = CHAIN_BY_KEY[fromChain].tokens;
    const map: Record<string, string> = {};
    for (const token of fromTokenOptions) {
      const raw = tokenBalances[makeBalanceKey(fromChain, token.address)];
      if (raw != null) {
        map[token.address.toLowerCase()] = formatUnits(raw, token.decimals, 4);
      }
    }
    return map;
  }, [fromChain, tokenBalances]);

  const refreshBalancesNow = () => setBalanceRefreshTick((t) => t + 1);

  const scheduleBalanceRefresh = () => {
    [2000, 10000, 30000].forEach((delay) => {
      setTimeout(() => setBalanceRefreshTick((t) => t + 1), delay);
    });
  };

  return {
    tokenBalances,
    isRefreshingBalances,
    balanceError,
    formattedSourceBalances,
    refreshBalancesNow,
    scheduleBalanceRefresh,
  };
}
