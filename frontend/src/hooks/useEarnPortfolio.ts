import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchPositions, deletePosition } from '../services/earnService';
import type { EarnPositionRecord } from '../types';

export function useEarnPortfolio(walletAddress: string | null) {
  const [positions, setPositions] = useState<EarnPositionRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const abortRef = useRef<AbortController | null>(null);

  const refresh = useCallback(async () => {
    if (!walletAddress) {
      setPositions([]);
      setError('');
      return;
    }

    // Cancel any in-flight request to prevent stale-wallet data
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;

    setLoading(true);
    setError('');

    try {
      const res = await fetchPositions(walletAddress);
      if (!ac.signal.aborted) {
        setPositions(res.positions ?? []);
      }
    } catch (err) {
      if (ac.signal.aborted) return;
      setError(err instanceof Error ? err.message : 'Failed to load positions');
    } finally {
      if (!ac.signal.aborted) setLoading(false);
    }
  }, [walletAddress]);

  // Auto-fetch when wallet changes
  useEffect(() => {
    if (walletAddress) {
      refresh();
    } else {
      setPositions([]);
      setError('');
    }
    return () => { abortRef.current?.abort(); };
  }, [walletAddress, refresh]);

  const removePosition = useCallback(async (id: string) => {
    try {
      await deletePosition(id);
      setPositions((prev) => prev.filter((p) => p._id !== id));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to remove position');
    }
  }, []);

  return {
    positions,
    loading,
    error,
    refresh,
    removePosition,
  };
}
