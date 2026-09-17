import { Loader2, X } from 'lucide-react';
import type { UserTransactionRecord } from '../services/transactionHistoryService';
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
  return (
    <div className="hf-dropdown-overlay" onClick={onClose}>
      <div
        className="hf-dropdown-panel hf-history-modal hf-fadeup"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="hf-dropdown-header">
          <h3>Transaction History</h3>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            {activeWalletAddress && (
              <span className="hf-history-address">
                {activeWalletAddress.slice(0, 6)}…{activeWalletAddress.slice(-4)}
              </span>
            )}
            <button className="hf-dropdown-close" onClick={onClose}>
              <X size={18} />
            </button>
          </div>
        </div>

        <div className="hf-history-modal-body">
          {historyLoading ? (
            <p className="hf-history-empty">
              <Loader2 size={14} className="hf-spin" style={{ display: 'inline', marginRight: '0.4rem', verticalAlign: 'middle' }} />
              Loading transactions…
            </p>
          ) : historyError ? (
            <p className="hf-history-empty">{historyError}</p>
          ) : historyRecords.length === 0 ? (
            <p className="hf-history-empty">No transactions yet for this wallet.</p>
          ) : (
            <div className="hf-history-list">
              {historyRecords.map((record) => {
                const chainKey = record.fromChain in BLOCK_EXPLORER
                  ? (record.fromChain as ChainKey)
                  : undefined;
                const explorerUrl = chainKey
                  ? `${BLOCK_EXPLORER[chainKey]}${record.txHash}`
                  : undefined;
                const timestamp = record.createdAt
                  ? new Date(record.createdAt).toLocaleString()
                  : 'Unknown time';

                return (
                  <div className="hf-history-item" key={`${record.txHash}-${record.createdAt ?? 'na'}`}>
                    <div className="hf-history-row">
                      <span className="hf-history-provider">{toProviderLabel(record.provider)}</span>
                      <span className="hf-history-status">{record.status ?? 'submitted'}</span>
                    </div>
                    <div className="hf-history-row">
                      <span className="hf-history-route">
                        {record.amount} {record.fromTokenSymbol} → {record.toTokenSymbol}
                      </span>
                      <span className="hf-history-chain">
                        {record.fromChain === record.toChain
                          ? record.fromChain
                          : `${record.fromChain} → ${record.toChain}`}
                      </span>
                    </div>
                    <div className="hf-history-row">
                      <span className="hf-history-time">{timestamp}</span>
                      {explorerUrl ? (
                        <a
                          href={explorerUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="hf-history-link"
                        >
                          View on Explorer
                        </a>
                      ) : (
                        <span className="hf-history-link hf-history-link-muted">Explorer N/A</span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
