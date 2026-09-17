import type { ChainKey } from '../lib/chains';

export type TxStage = 'submitted' | 'confirming' | 'bridging' | 'completed' | 'failed' | 'pending';

export interface TxStatusResult {
  status: TxStage;
  substatus?: string;         // Human-readable message (may come straight from LI.FI)
  substatusCode?: string;     // Raw LI.FI enum (e.g. WAIT_SOURCE_CONFIRMATIONS)
  sendingTxHash?: string;     // Source-chain tx
  receivingTxHash?: string;   // Destination-chain tx (cross-chain only, appears late)
  explorerLink?: string;      // Best explorer link (destination tx if available, else LI.FI)
  lifiExplorerLink?: string;  // LI.FI cross-chain explorer
}

function resolveApiBaseUrl(): string {
  const fromEnv = import.meta.env.VITE_HOPFAST_API_BASE_URL;
  if (fromEnv && fromEnv.trim().length > 0) {
    return fromEnv.replace(/\/$/, '');
  }

  if (
    typeof window !== 'undefined' &&
    ['localhost', '127.0.0.1'].includes(window.location.hostname)
  ) {
    return 'http://localhost:8080/api';
  }

  return '';
}

export async function fetchTransactionStatus(
  txHash: string,
  provider: string,
  fromChain: ChainKey,
  toChain?: ChainKey
): Promise<TxStatusResult> {
  const base = resolveApiBaseUrl();
  if (!base) {
    throw new Error('Backend API URL unavailable.');
  }

  const params = new URLSearchParams({ txHash, provider, fromChain });
  // Per LI.FI docs, same-chain swaps require toChain == fromChain, else
  // NOT_FOUND. Default to fromChain when the caller doesn't specify.
  params.set('toChain', toChain ?? fromChain);
  const response = await fetch(`${base}/status?${params.toString()}`);

  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || `Status check failed (${response.status}).`);
  }

  return response.json() as Promise<TxStatusResult>;
}

const STAGE_PROGRESS: Record<TxStage, number> = {
  submitted: 10,
  pending: 15,
  confirming: 30,
  bridging: 60,
  completed: 100,
  // Keep the progress bar visible on failure — the UI recolors it red
  // instead of collapsing to 0 so the user sees a clear failed state.
  failed: 100
};

export function stageToProgress(stage: TxStage): number {
  return STAGE_PROGRESS[stage] ?? 10;
}

/**
 * Poll transaction status until a terminal state is reached.
 * Calls onUpdate with each new status. Returns the final status.
 *
 * For LI.FI, toChain MUST be supplied (same-chain swaps require fromChain === toChain).
 */
export function pollTransactionStatus(
  txHash: string,
  provider: string,
  fromChain: ChainKey,
  onUpdate: (result: TxStatusResult) => void,
  toChain?: ChainKey,
  intervalMs = 5000,
  maxAttempts = 120
): { stop: () => void } {
  let stopped = false;
  let attempts = 0;
  let consecutiveErrors = 0;
  let timeoutId: ReturnType<typeof setTimeout> | undefined;

  const poll = async () => {
    if (stopped) return;
    attempts++;

    try {
      const result = await fetchTransactionStatus(txHash, provider, fromChain, toChain);
      if (stopped) return;
      consecutiveErrors = 0;
      onUpdate(result);

      if (result.status === 'completed' || result.status === 'failed') {
        return; // Terminal — stop polling
      }
    } catch (err) {
      consecutiveErrors++;
      // If the status endpoint has been unreachable for several attempts
      // in a row, surface it as a failure so the user isn't left waiting.
      if (consecutiveErrors >= 6 && !stopped) {
        onUpdate({
          status: 'pending',
          substatus: 'Status check unavailable. Check the explorer link for the latest state.'
        });
        return;
      }
      // eslint-disable-next-line no-console
      console.warn('[status-poll] fetch failed, will retry', err);
    }

    if (attempts < maxAttempts && !stopped) {
      timeoutId = setTimeout(poll, intervalMs);
    } else if (attempts >= maxAttempts && !stopped) {
      // Hit the 10-minute wall without a terminal state.
      onUpdate({
        status: 'pending',
        substatus: 'Timed out waiting for confirmation. Check the explorer link for the latest state.'
      });
    }
  };

  // Start after initial delay (tx needs time to propagate)
  timeoutId = setTimeout(poll, 3000);

  return {
    stop: () => {
      stopped = true;
      if (timeoutId) clearTimeout(timeoutId);
    }
  };
}
