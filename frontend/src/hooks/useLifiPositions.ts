import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchLifiPositions } from '../services/earnService';
import type { LifiPosition } from '../types';

/** How often to auto-refresh when actively viewing positions (60 s) */
const POLL_INTERVAL = 60_000;

export function useLifiPositions(walletAddress: string | null) {
  const [positions, setPositions] = useState<LifiPosition[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  /**
   * Fetch positions. Cancels any in-flight request first.
   * @param silent - true for background polls (no loading spinner)
   */
  const refresh = useCallback(async (silent = false) => {
    if (!walletAddress) {
      setPositions([]);
      setError('');
      return;
    }

    // Cancel any in-flight request to prevent stale data from resolving
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;

    if (!silent) setLoading(true);
    setError('');

    try {
      const res = await fetchLifiPositions(walletAddress, ac.signal);
      // Only update state if this request wasn't aborted
      if (!ac.signal.aborted) {
        setPositions(res.positions ?? []);
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return;
      if (!ac.signal.aborted) {
        setError(err instanceof Error ? err.message : 'Failed to load live positions');
      }
    } finally {
      if (!ac.signal.aborted && !silent) {
        setLoading(false);
      }
    }
  }, [walletAddress]);

  // Fetch on mount & whenever wallet address changes
  useEffect(() => {
    if (walletAddress) {
      refresh();
    } else {
      setPositions([]);
      setError('');
    }
    // Abort in-flight request on cleanup (wallet change or unmount)
    return () => { abortRef.current?.abort(); };
  }, [walletAddress, refresh]);

  /** Stop any active polling interval */
  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  /** Start polling — call when positions tab is active */
  const startPolling = useCallback(() => {
    stopPolling();
    if (!walletAddress) return;
    // Immediately refresh, then poll silently
    refresh();
    pollRef.current = setInterval(() => {
      refresh(true);
    }, POLL_INTERVAL);
  }, [walletAddress, refresh, stopPolling]);

  // If wallet changes while polling is active, restart with new wallet
  useEffect(() => {
    if (pollRef.current) {
      stopPolling();
      if (walletAddress) startPolling();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [walletAddress]);

  // Cleanup on unmount
  useEffect(() => {
    return () => { stopPolling(); };
  }, [stopPolling]);

  return { positions, loading, error, refresh, startPolling, stopPolling };
}
