import type { ChainKey } from './lib/chains';
import type { ProviderKey, SwapDraft, TxStage } from './types';

export const HAS_PRIVY = Boolean(import.meta.env.VITE_PRIVY_APP_ID);
export const IS_PROD = import.meta.env.PROD;

export const DEFAULT_DRAFT: SwapDraft = {
  fromChain: 'ethereum',
  toChain: 'base',
  fromTokenSymbol: 'ETH',
  toTokenSymbol: 'ETH',
  amount: ''
};

export const DEBOUNCE_MS = 1000;
export const QUOTE_REFRESH_INTERVAL_S = 60;
export const HISTORY_LIMIT = 50;

export const API_BASE_URL =
  (import.meta.env.VITE_HOPFAST_API_BASE_URL ?? '').replace(/\/$/, '') || 'http://localhost:8080/api';

export const LIVE_PROVIDERS: ProviderKey[] = ['lifi', 'squid'];

export const PROVIDER_META: { key: ProviderKey; label: string; logo: string }[] = [
  { key: 'lifi',     label: 'LI.FI',    logo: '/providers/lifi.png'     },
  { key: 'squid',    label: 'Squid',     logo: '/providers/squid.ico'    },
];

export const BLOCK_EXPLORER: Record<ChainKey, string> = {
  ethereum: 'https://etherscan.io/tx/',
  base: 'https://basescan.org/tx/',
  bsc: 'https://bscscan.com/tx/',
  polygon: 'https://polygonscan.com/tx/',
  monad: 'https://monadscan.com/tx/'
};

export const TX_STAGES: { key: TxStage; label: string }[] = [
  { key: 'submitted',  label: 'Submitted' },
  { key: 'confirming', label: 'Confirming' },
  { key: 'bridging',   label: 'Bridging' },
  { key: 'completed',  label: 'Complete' }
];
