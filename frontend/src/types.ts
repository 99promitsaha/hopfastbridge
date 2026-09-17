import type { ChainKey } from './lib/chains';
import type { TxStage as StatusTxStage } from './services/transactionStatusService';

export type EntryView = 'landing' | 'human' | 'agent' | 'stats';

export type HumanTab = 'swap' | 'earn';

export type ProviderKey = 'lifi' | 'debridge' | 'squid' | 'relay';

export interface SwapDraft {
  fromChain: ChainKey;
  toChain: ChainKey;
  fromTokenSymbol: string;
  toTokenSymbol: string;
  amount: string;
}

export type TxStage = StatusTxStage;

export interface TxStatus {
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

/* ─── Earn Types ─────────────────────────────────────── */

export interface EarnVaultToken {
  address: string;
  symbol: string;
  decimals: number;
}

export interface EarnVault {
  address: string;
  network: string;
  chainId: number;
  slug: string;
  name: string;
  description: string;
  protocol: {
    name: string;
    url: string;
  };
  underlyingTokens: EarnVaultToken[];
  lpTokens: EarnVaultToken[];
  tags: string[];
  analytics: {
    apy: {
      base: number | null;
      reward: number | null;
      total: number | null;
    };
    apy1d: number | null;
    apy7d: number | null;
    apy30d: number | null;
    tvl: {
      usd: string;
    };
    updatedAt: string;
  };
  isTransactional: boolean;
  isRedeemable: boolean;
  depositPacks: Array<{ name: string; stepsType: string }>;
  redeemPacks: Array<{ name: string; stepsType: string }>;
}

export interface EarnVaultsResponse {
  data: EarnVault[];
  nextCursor: string | null;
  total: number;
}

export interface EarnPositionRecord {
  _id: string;
  userAddress: string;
  vaultAddress: string;
  vaultName: string;
  chainId: number;
  network: string;
  protocolName: string;
  protocolUrl: string;
  tokenSymbol: string;
  tokenAddress: string;
  tokenDecimals: number;
  amount: string;
  amountRaw: string;
  txHash: string;
  action: string;
  note: string;
  createdAt: string;
}

export interface EarnPortfolioResponse {
  positions: EarnPositionRecord[];
}

export interface LifiPosition {
  chainId: number;
  protocolName: string;
  asset: {
    address: string;
    name: string;
    symbol: string;
    decimals: number;
  };
  balanceUsd: string;
  balanceNative: string;
}

export interface LifiPortfolioResponse {
  positions: LifiPosition[];
}

export type EarnSortBy = 'apy' | 'tvl';

export interface EarnPreference {
  riskAppetite: 'high' | 'safe';
  preferredAsset: 'USDC' | 'USDT' | 'ETH' | 'WBTC' | 'DAI' | 'stablecoins' | 'ETH_FAMILY' | 'BTC_FAMILY' | 'any';
  experienceLevel: 'beginner' | 'intermediate' | 'advanced';
}

export interface EarnFilters {
  chainId: number | null;
  stablecoinOnly: boolean;
  sortBy: EarnSortBy;
  search: string;
  protocol: string | null;
  asset: string | null;
}
