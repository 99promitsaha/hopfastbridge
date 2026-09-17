import { CHAINS, CHAIN_BY_KEY, getDefaultToken, getToken, type ChainKey } from './chains';
import type { SwapDraft } from '../types';

export function makeBalanceKey(chain: ChainKey, tokenAddress: string): string {
  return `${chain}:${tokenAddress.toLowerCase()}`;
}

export function toProviderLabel(provider?: string): string {
  if (!provider) return 'Unknown';
  return provider.replace(/-api$/i, '').replace(/^./, (char) => char.toUpperCase());
}

export function getAnotherChain(chain: ChainKey): ChainKey {
  const allKeys = CHAINS.map((c) => c.key);
  const idx = allKeys.indexOf(chain);
  return allKeys[(idx + 1) % allKeys.length];
}

export function getDifferentToken(chain: ChainKey, excludeSymbol: string): string {
  const tokens = CHAIN_BY_KEY[chain].tokens;
  const other = tokens.find((t) => t.symbol !== excludeSymbol);
  return other?.symbol ?? tokens[0].symbol;
}

export function resolveToken(chain: ChainKey, preferred?: string, fallback?: string): string {
  if (preferred && getToken(chain, preferred)) return preferred;
  if (fallback && getToken(chain, fallback)) return fallback;
  return getDefaultToken(chain).symbol;
}

export function toHexQuantity(value?: string): string | undefined {
  if (!value) return undefined;
  if (value.startsWith('0x')) return value;
  try {
    return `0x${BigInt(value).toString(16)}`;
  } catch {
    return undefined;
  }
}

export function isValidSwapInput(draft: SwapDraft): boolean {
  if (draft.fromChain === draft.toChain && draft.fromTokenSymbol === draft.toTokenSymbol) return false;
  const amount = Number(draft.amount);
  return Number.isFinite(amount) && amount > 0;
}

const ETH_ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;

/**
 * Validates that a transaction request from an external API has safe fields
 * before the user signs it. Prevents malicious `to` addresses or missing data.
 */
export function validateTransactionRequest(tx: {
  to?: string;
  data?: string;
  value?: string;
}): string | null {
  if (!tx.to || !ETH_ADDRESS_RE.test(tx.to)) {
    return 'Invalid transaction target address.';
  }
  if (!tx.data || tx.data.length < 10) {
    return 'Transaction data is missing or malformed.';
  }
  return null; // valid
}
