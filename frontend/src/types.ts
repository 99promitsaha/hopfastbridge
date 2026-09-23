import type { ChainKey } from './lib/chains';
import type { TxStage as StatusTxStage } from './services/transactionStatusService';

export type EntryView = 'human' | 'stats' | 'payment' | 'deployment';

export type ProviderKey = 'lifi' | 'squid';

export interface SwapDraft {
  fromChain: ChainKey;
  toChain: ChainKey;
  fromTokenSymbol: string;
  toTokenSymbol: string;
  amount: string;
}

export type TxStage = StatusTxStage;

export interface TxStatus {
  fromChain?: ChainKey;
  toChain?: ChainKey;
  hash: string;
  stage: TxStage;
  progress: number;
  substatus?: string;
  substatusCode?: string;
  sendingTxHash?: string;
  receivingTxHash?: string;
  explorerLink?: string;
  lifiExplorerLink?: string;
}
