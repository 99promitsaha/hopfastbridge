import { API_BASE_URL } from '../constants';
import type { EarnVaultsResponse, EarnPortfolioResponse, EarnPositionRecord, EarnPreference, LifiPortfolioResponse } from '../types';

/**
 * All Earn Data API calls are proxied through our backend
 * to avoid CORS issues (earn.li.fi doesn't set Access-Control-Allow-Origin).
 */

export async function fetchVaults(params: {
  chainId?: number;
  asset?: string;
  protocol?: string;
  minTvlUsd?: number;
  sortBy?: 'apy' | 'tvl';
  cursor?: string;
  limit?: number;
}): Promise<EarnVaultsResponse> {
  const qs = new URLSearchParams();
  if (params.chainId) qs.set('chainId', String(params.chainId));
  if (params.asset) qs.set('asset', params.asset);
  if (params.protocol) qs.set('protocol', params.protocol);
  if (params.minTvlUsd != null) qs.set('minTvlUsd', String(params.minTvlUsd));
  if (params.sortBy) qs.set('sortBy', params.sortBy);
  if (params.cursor) qs.set('cursor', params.cursor);
  if (params.limit) qs.set('limit', String(params.limit));

  const res = await fetch(`${API_BASE_URL}/earn/vaults?${qs}`);
  if (!res.ok) throw new Error(`Earn API error: ${res.status}`);
  return res.json();
}

export async function fetchEarnChains(): Promise<Array<{ id: number; name: string }>> {
  const res = await fetch(`${API_BASE_URL}/earn/chains`);
  if (!res.ok) throw new Error(`Earn chains error: ${res.status}`);
  return res.json();
}

export async function fetchEarnProtocols(): Promise<Array<{ name: string }>> {
  const res = await fetch(`${API_BASE_URL}/earn/protocols`);
  if (!res.ok) throw new Error(`Earn protocols error: ${res.status}`);
  return res.json();
}

/* ─── LI.FI Live Portfolio ───────────────────────────── */

export async function fetchLifiPositions(walletAddress: string, signal?: AbortSignal): Promise<LifiPortfolioResponse> {
  if (!/^0x[0-9a-fA-F]{40}$/.test(walletAddress)) throw new Error('Invalid wallet address');
  const res = await fetch(`${API_BASE_URL}/earn/portfolio/${walletAddress}/positions`, { signal });
  if (!res.ok) throw new Error(`Live positions error: ${res.status}`);
  return res.json();
}

/* ─── Earn Position CRUD ─────────────────────────────── */

export async function fetchPositions(walletAddress: string): Promise<EarnPortfolioResponse> {
  const res = await fetch(`${API_BASE_URL}/earn/positions/${walletAddress}`);
  if (!res.ok) throw new Error(`Positions error: ${res.status}`);
  return res.json();
}

export async function savePosition(data: {
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
}): Promise<EarnPositionRecord> {
  const res = await fetch(`${API_BASE_URL}/earn/positions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error(`Save position error: ${res.status}`);
  const body = await res.json();
  return body.position;
}

export async function deletePosition(id: string): Promise<void> {
  const res = await fetch(`${API_BASE_URL}/earn/positions/${id}`, { method: 'DELETE' });
  if (!res.ok) throw new Error(`Delete position error: ${res.status}`);
}

/* ─── Earn Preferences ───────────────────────────────── */

export async function fetchPreferences(walletAddress: string): Promise<EarnPreference | null> {
  const res = await fetch(`${API_BASE_URL}/earn/preferences/${walletAddress}`);
  if (!res.ok) return null;
  const body = await res.json();
  return body.preference ?? null;
}

export async function savePreferences(
  walletAddress: string,
  prefs: EarnPreference
): Promise<void> {
  await fetch(`${API_BASE_URL}/earn/preferences`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userAddress: walletAddress, ...prefs }),
  });
}

