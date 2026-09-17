import { NATIVE_TOKEN_ADDRESS, type ChainKey } from '../lib/chains';

interface TokenDef {
  address: string;
  symbol: string;
  decimals: number;
}

const BALANCE_OF_SELECTOR = '0x70a08231';

// Alchemy-supported chains get fast batch balance fetching
const ALCHEMY_CHAIN_SUBDOMAIN: Partial<Record<ChainKey, string>> = {
  ethereum: 'eth-mainnet',
  base: 'base-mainnet',
  polygon: 'polygon-mainnet'
};

// BSC and Monad are NOT supported by Alchemy — use public RPCs as fallback
const FALLBACK_RPC_BY_CHAIN: Partial<Record<ChainKey, string[]>> = {
  bsc: ['https://binance.llamarpc.com', 'https://bsc-rpc.publicnode.com'],
  monad: ['https://rpc.monad.xyz', 'https://monad-mainnet.drpc.org']
};

function getAlchemyApiKey(): string | undefined {
  const key = import.meta.env.VITE_ALCHEMY_API_KEY;
  return typeof key === 'string' && key.trim().length > 0 ? key.trim() : undefined;
}

function getAlchemyUrl(chain: ChainKey): string | undefined {
  const key = getAlchemyApiKey();
  const subdomain = ALCHEMY_CHAIN_SUBDOMAIN[chain];
  if (!key || !subdomain) return undefined;
  return `https://${subdomain}.g.alchemy.com/v2/${key}`;
}

function encodeBalanceOf(address: string): string {
  const normalized = address.toLowerCase().replace(/^0x/, '');
  return `${BALANCE_OF_SELECTOR}${normalized.padStart(64, '0')}`;
}

function parseHexToBigInt(hexValue: unknown): bigint {
  if (typeof hexValue !== 'string') return 0n;
  try {
    return BigInt(hexValue);
  } catch {
    return 0n;
  }
}

async function rpcCall<T>(rpcUrl: string, method: string, params: unknown[], id: number): Promise<T> {
  const response = await fetch(rpcUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id, method, params })
  });

  if (!response.ok) {
    throw new Error(`RPC request failed (${response.status}).`);
  }

  const payload = (await response.json()) as {
    result?: T;
    error?: { message?: string };
  };

  if (payload.error) {
    throw new Error(payload.error.message ?? 'RPC responded with an error.');
  }

  return payload.result as T;
}

// ── Alchemy batch balance fetch (single RPC call for all ERC-20s + native) ──
async function fetchBalancesViaAlchemy(
  alchemyUrl: string,
  walletAddress: string,
  tokens: TokenDef[]
): Promise<Record<string, bigint>> {
  const balances: Record<string, bigint> = {};
  const address = walletAddress.toLowerCase();

  const nativeToken = tokens.find(
    (t) => t.address.toLowerCase() === NATIVE_TOKEN_ADDRESS.toLowerCase()
  );
  const erc20Tokens = tokens.filter(
    (t) => t.address.toLowerCase() !== NATIVE_TOKEN_ADDRESS.toLowerCase()
  );

  const batchRequests: Array<{ jsonrpc: string; id: number; method: string; params: unknown[] }> = [];
  let requestId = 1;

  if (nativeToken) {
    batchRequests.push({
      jsonrpc: '2.0',
      id: requestId++,
      method: 'eth_getBalance',
      params: [address, 'latest']
    });
  }

  if (erc20Tokens.length > 0) {
    batchRequests.push({
      jsonrpc: '2.0',
      id: requestId++,
      method: 'alchemy_getTokenBalances',
      params: [address, erc20Tokens.map((t) => t.address)]
    });
  }

  if (batchRequests.length === 0) return balances;

  const response = await fetch(alchemyUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(batchRequests)
  });

  if (!response.ok) {
    throw new Error(`Alchemy batch request failed (${response.status}).`);
  }

  const results = (await response.json()) as Array<{
    id: number;
    result?: unknown;
    error?: { message?: string };
  }>;

  for (const result of results) {
    if (result.error) continue;

    if (typeof result.result === 'string') {
      if (nativeToken) {
        balances[nativeToken.address.toLowerCase()] = parseHexToBigInt(result.result);
      }
      continue;
    }

    const tokenResult = result.result as {
      tokenBalances?: Array<{
        contractAddress?: string;
        tokenBalance?: string;
        error?: string;
      }>;
    };

    if (tokenResult?.tokenBalances) {
      for (const entry of tokenResult.tokenBalances) {
        if (entry.error || !entry.contractAddress) continue;
        balances[entry.contractAddress.toLowerCase()] = parseHexToBigInt(entry.tokenBalance);
      }
    }
  }

  return balances;
}

// ── Fallback: individual RPC calls (used for BSC and when Alchemy isn't configured) ──
async function fetchBalancesViaRpc(
  rpcUrl: string,
  walletAddress: string,
  tokens: TokenDef[]
): Promise<Record<string, bigint>> {
  const address = walletAddress.toLowerCase();
  const dedupedTokens = Array.from(
    new Map(tokens.map((token) => [token.address.toLowerCase(), token])).values()
  );
  const balances: Record<string, bigint> = {};

  await runWithConcurrency(dedupedTokens, 4, async (token, index) => {
    try {
      if (token.address.toLowerCase() === NATIVE_TOKEN_ADDRESS.toLowerCase()) {
        const balanceHex = await rpcCall<string>(rpcUrl, 'eth_getBalance', [address, 'latest'], index + 1);
        balances[token.address.toLowerCase()] = parseHexToBigInt(balanceHex);
        return;
      }

      const data = encodeBalanceOf(address);
      const balanceHex = await rpcCall<string>(
        rpcUrl,
        'eth_call',
        [{ to: token.address, data }, 'latest'],
        index + 1
      );
      balances[token.address.toLowerCase()] = parseHexToBigInt(balanceHex);
    } catch {
      // Don't force zero on RPC failures — treat as unknown
    }
  });

  return balances;
}

async function runWithConcurrency<T>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<void>
): Promise<void> {
  if (!items.length) return;
  let cursor = 0;

  const runners = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (true) {
      const current = cursor;
      cursor += 1;
      if (current >= items.length) return;
      await worker(items[current], current);
    }
  });

  await Promise.all(runners);
}

/**
 * Fetch all token balances for a chain.
 * Uses Alchemy batch API when available, falls back to individual RPC calls.
 */
export async function fetchTokenBalancesForChain(
  chainKey: ChainKey,
  walletAddress: string,
  tokens: TokenDef[]
): Promise<Record<string, bigint>> {
  const alchemyUrl = getAlchemyUrl(chainKey);
  if (alchemyUrl) {
    try {
      return await fetchBalancesViaAlchemy(alchemyUrl, walletAddress, tokens);
    } catch {
    }
  }

  const fallbackRpcs = FALLBACK_RPC_BY_CHAIN[chainKey];
  const rpcUrl = fallbackRpcs?.[0];
  if (!rpcUrl) {
    // No RPC available — try Alchemy-supported chain RPCs as last resort
    const publicRpcs: Record<string, string> = {
      ethereum: 'https://eth.llamarpc.com',
      base: 'https://base.llamarpc.com',
      polygon: 'https://polygon.llamarpc.com'
    };
    const lastResort = publicRpcs[chainKey];
    if (lastResort) {
      return fetchBalancesViaRpc(lastResort, walletAddress, tokens);
    }
    return {};
  }

  return fetchBalancesViaRpc(rpcUrl, walletAddress, tokens);
}

/**
 * Fetch a single token's balance with RPC fallback across multiple endpoints.
 */
export async function fetchSingleTokenBalance(
  chainKey: ChainKey,
  walletAddress: string,
  token: TokenDef
): Promise<bigint | null> {
  const address = walletAddress.toLowerCase();
  const tokenAddress = token.address.toLowerCase();

  const alchemyUrl = getAlchemyUrl(chainKey);
  if (alchemyUrl) {
    try {
      const balances = await fetchBalancesViaAlchemy(alchemyUrl, address, [token]);
      const balance = balances[tokenAddress];
      if (balance != null) return balance;
    } catch {
    }
  }

  const rpcs = FALLBACK_RPC_BY_CHAIN[chainKey] ?? [
    chainKey === 'ethereum' ? 'https://eth.llamarpc.com' :
    chainKey === 'base'     ? 'https://base.llamarpc.com' :
    chainKey === 'polygon'  ? 'https://polygon.llamarpc.com' :
    chainKey === 'monad'    ? 'https://rpc.monad.xyz' :
    undefined
  ].filter(Boolean) as string[];

  for (const rpcUrl of rpcs) {
    try {
      if (tokenAddress === NATIVE_TOKEN_ADDRESS.toLowerCase()) {
        const balanceHex = await rpcCall<string>(rpcUrl, 'eth_getBalance', [address, 'latest'], 1);
        return parseHexToBigInt(balanceHex);
      }

      const data = encodeBalanceOf(address);
      const balanceHex = await rpcCall<string>(
        rpcUrl,
        'eth_call',
        [{ to: token.address, data }, 'latest'],
        1
      );
      return parseHexToBigInt(balanceHex);
    } catch {
    }
  }

  return null;
}
