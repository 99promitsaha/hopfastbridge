import { Dialog } from './Dialog';
import { Loader2 } from 'lucide-react';
import { useState } from 'react';
import type { UserTransactionRecord } from '../services/transactionHistoryService';
import { fetchTransactionStatus } from '../services/transactionStatusService';
import { BLOCK_EXPLORER } from '../constants';
import { toProviderLabel } from '../lib/swap';
import type { ChainKey } from '../lib/chains';

interface TransactionHistoryModalProps {
  activeWalletAddress: string | null;
  historyRecords: UserTransactionRecord[];
  historyLoading: boolean;
  historyError: string;
  onClose: () => void;
}

export function TransactionHistoryModal({
  activeWalletAddress,
  historyRecords,
  historyLoading,
  historyError,
  onClose,
}: TransactionHistoryModalProps) {
  const [refreshingHash, setRefreshingHash] = useState<string | null>(null);
  const [statusOverrides, setStatusOverrides] = useState<
    Record<string, string>
  >({});

  const refreshStatus = async (record: UserTransactionRecord) => {
    if (
      !(record.fromChain in BLOCK_EXPLORER) ||
      !(record.toChain in BLOCK_EXPLORER)
    )
      return;
    const metadata =
      record.metadata && typeof record.metadata === 'object'
        ? (record.metadata as Record<string, unknown>)
        : {};
    setRefreshingHash(record.txHash);
    try {
      const result = await fetchTransactionStatus(
        record.txHash,
        record.provider ?? 'lifi',
        record.fromChain as ChainKey,
        record.toChain as ChainKey,
        {
          quoteId:
            typeof metadata.quoteId === 'string' ? metadata.quoteId : undefined,
          requestId:
            typeof metadata.requestId === 'string'
              ? metadata.requestId
              : undefined,
        }
      );
      setStatusOverrides((current) => ({
        ...current,
        [record.txHash]: result.status,
      }));
    } finally {
      setRefreshingHash(null);
    }
  };

  return (
    <Dialog
      className="hf-history-modal"
      title="Bridge activity"
      onClose={onClose}
      headerExtra={
        activeWalletAddress ? (
          <span className="hf-history-address">
            {activeWalletAddress.slice(0, 6)}…{activeWalletAddress.slice(-4)}
          </span>
        ) : undefined
      }
    >
      <div className="hf-history-modal-body">
        {historyLoading ? (
          <p className="hf-history-empty">
            <Loader2
              size={14}
              className="hf-spin"
              style={{
                display: 'inline',
                marginRight: '0.4rem',
                verticalAlign: 'middle',
              }}
            />
            Loading transactions…
          </p>
        ) : historyError ? (
          <p className="hf-history-empty">{historyError}</p>
        ) : historyRecords.length === 0 ? (
          <p className="hf-history-empty">Bridge transactions from this wallet will appear here.</p>
        ) : (
          <div className="hf-history-list">
            {historyRecords.map((record) => {
              const chainKey =
                record.fromChain in BLOCK_EXPLORER
                  ? (record.fromChain as ChainKey)
                  : undefined;
              const explorerUrl = chainKey
                ? `${BLOCK_EXPLORER[chainKey]}${record.txHash}`
                : undefined;
              const timestamp = record.createdAt
                ? new Date(record.createdAt).toLocaleString()
                : 'Unknown time';

              return (
                <div
                  className="hf-history-item"
                  key={`${record.txHash}-${record.createdAt ?? 'na'}`}
                >
                  <div className="hf-history-row">
                    <span className="hf-history-provider">
                      {toProviderLabel(record.provider)}
                    </span>
                    <span className="hf-history-status">
                      {statusOverrides[record.txHash] ??
                        record.status ??
                        'submitted'}
                    </span>
                  </div>
                  <div className="hf-history-row">
                    <span className="hf-history-route">
                      {record.amount} {record.fromTokenSymbol} →{' '}
                      {record.toTokenSymbol}
                    </span>
                    <span className="hf-history-chain">
                      {record.fromChain === record.toChain
                        ? record.fromChain
                        : `${record.fromChain} → ${record.toChain}`}
                    </span>
                  </div>
                  <div className="hf-history-row">
                    <span className="hf-history-time">{timestamp}</span>
                    <button
                      type="button"
                      className="hf-history-link"
                      disabled={refreshingHash === record.txHash}
                      onClick={() => void refreshStatus(record)}
                    >
                      {refreshingHash === record.txHash
                        ? 'Checking…'
                        : 'Refresh status'}
                    </button>
                    {explorerUrl ? (
                      <a
                        href={explorerUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="hf-history-link"
                      >
                        Open in explorer
                      </a>
                    ) : (
                      <span className="hf-history-link hf-history-link-muted">
                        Explorer unavailable
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </Dialog>
  );
}
