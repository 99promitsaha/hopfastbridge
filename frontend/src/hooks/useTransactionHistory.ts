import { useEffect, useState } from 'react';
import { fetchUserTransactionHistory, type UserTransactionRecord } from '../services/transactionHistoryService';
import { HISTORY_LIMIT } from '../constants';

export function useTransactionHistory(
  isOpen: boolean,
  activeWalletAddress: string | null,
  txHash?: string
) {
  const [historyRecords, setHistoryRecords] = useState<UserTransactionRecord[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState('');

  useEffect(() => {
    if (!isOpen) return;

    if (!activeWalletAddress) {
      setHistoryRecords([]);
      setHistoryError('Connect wallet to view transaction history.');
      return;
    }

    let cancelled = false;

    const loadHistory = async () => {
      try {
        setHistoryLoading(true);
        setHistoryError('');
        const records = await fetchUserTransactionHistory(activeWalletAddress, HISTORY_LIMIT);
        if (!cancelled) {
          setHistoryRecords(records);
        }
      } catch (caughtError) {
        if (!cancelled) {
          setHistoryError(caughtError instanceof Error ? caughtError.message : 'Failed to load transaction history.');
          setHistoryRecords([]);
        }
      } finally {
        if (!cancelled) {
          setHistoryLoading(false);
        }
      }
    };

    loadHistory().catch(() => {});

    return () => { cancelled = true; };
  }, [isOpen, activeWalletAddress, txHash]);

  return { historyRecords, historyLoading, historyError };
}
