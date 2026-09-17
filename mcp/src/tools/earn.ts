/**
 * Earn tools — yield vault discovery, quotes, positions, and preferences
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { hopfastFetch } from '../client.js';

const CHAIN_KEYS = ['ethereum', 'base', 'bsc', 'polygon', 'monad'] as const;

// Numeric chain IDs used by the earn API
const CHAIN_IDS: Record<string, number> = {
  ethereum: 1,
  base: 8453,
  bsc: 56,
  polygon: 137,
  monad: 143,
};

export function registerEarnTools(server: McpServer): void {
  // ─── get_earn_vaults ───────────────────────────────────────────────────────
  server.tool(
    'get_earn_vaults',
    `Browse yield-earning vaults aggregated by HopFast via LI.FI.
Each vault shows: protocol name, token accepted, current APY, total value locked (TVL),
chain, and vault contract address.

Use this to find the best yield opportunities for a user's assets.
Filter by chain, token symbol, or protocol to narrow results.
Sort by "apy" to find highest yields, or "tvl" for most established vaults.`,
    {
      chainKey: z
        .enum(CHAIN_KEYS)
        .optional()
        .describe('Filter by chain (ethereum | base | bsc | polygon | monad).'),
      asset: z
        .string()
        .optional()
        .describe('Filter by token symbol (e.g. "USDC", "ETH", "USDT").'),
      protocol: z
        .string()
        .optional()
        .describe('Filter by protocol name (e.g. "Aave", "Morpho", "Euler").'),
      minTvlUsd: z
        .number()
        .optional()
        .describe('Minimum TVL in USD to filter out low-liquidity vaults.'),
      sortBy: z
        .enum(['apy', 'tvl'])
        .optional()
        .describe('Sort vaults by APY (highest first) or TVL (largest first). Default: apy.'),
      limit: z
        .number()
        .int()
        .min(1)
        .max(50)
        .optional()
        .describe('Number of vaults to return (1–50, default 10).'),
    },
    async ({ chainKey, asset, protocol, minTvlUsd, sortBy, limit }) => {
      const query = new URLSearchParams();
      if (chainKey) query.set('chainId', String(CHAIN_IDS[chainKey]));
      if (asset) query.set('asset', asset);
      if (protocol) query.set('protocol', protocol);
      if (minTvlUsd !== undefined) query.set('minTvlUsd', String(minTvlUsd));
      if (sortBy) query.set('sortBy', sortBy);
      if (limit !== undefined) query.set('limit', String(limit));

      const result = await hopfastFetch<unknown>(`/api/earn/vaults?${query}`);

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    },
  );

  // ─── get_earn_quote ────────────────────────────────────────────────────────
  server.tool(
    'get_earn_quote',
    `Get a quote for depositing tokens into a yield vault.
Returns a signed transaction request you can send to the user's wallet for execution,
plus estimated fees, ETA, and expected vault tokens received.

Use after calling get_earn_vaults to find a vault — pass the vault's token address
as toTokenAddress and the user's token address as fromTokenAddress.`,
    {
      fromTokenAddress: z
        .string()
        .describe("Token the user wants to deposit (e.g. USDC contract address on Base)."),
      toTokenAddress: z
        .string()
        .describe("Vault's receipt/LP token address (from get_earn_vaults result)."),
      amount: z
        .string()
        .describe('Amount in smallest unit (wei). E.g. "1000000" for 1 USDC (6 decimals).'),
      chainId: z
        .number()
        .int()
        .describe('Chain ID where the vault lives (1=Ethereum, 8453=Base, 56=BSC, 137=Polygon, 143=Monad).'),
      walletAddress: z
        .string()
        .optional()
        .describe("User's wallet address (required for a real executable transaction)."),
    },
    async ({ fromTokenAddress, toTokenAddress, amount, chainId, walletAddress }) => {
      const body: Record<string, unknown> = {
        srcTokenAddress: fromTokenAddress,
        dstTokenAddress: toTokenAddress,
        amount,
        srcChainId: chainId,
        dstChainId: chainId,
      };
      if (walletAddress) {
        body.srcWalletAddress = walletAddress;
        body.dstWalletAddress = walletAddress;
      }

      const result = await hopfastFetch<unknown>('/api/earn/quote', {
        method: 'POST',
        body: JSON.stringify(body),
      });

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    },
  );

  // ─── get_earn_positions ────────────────────────────────────────────────────
  server.tool(
    'get_earn_positions',
    `Retrieve a user's active yield vault positions tracked in HopFast.
Shows all vaults the user has deposited into, including vault name, protocol,
chain, token, deposited amount, and deposit transaction hash.`,
    {
      walletAddress: z
        .string()
        .describe("User's wallet address (0x...)."),
    },
    async ({ walletAddress }) => {
      const result = await hopfastFetch<{ positions: unknown[] }>(
        `/api/earn/positions/${walletAddress}`,
      );

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    },
  );

  // ─── record_earn_deposit ───────────────────────────────────────────────────
  server.tool(
    'record_earn_deposit',
    `Save a completed vault deposit to HopFast so it appears in the user's
earn positions. Call this immediately after the user's deposit transaction
is confirmed on-chain.`,
    {
      walletAddress: z
        .string()
        .describe("User's wallet address (0x...)."),
      vaultAddress: z
        .string()
        .describe('Vault contract address (0x...).'),
      vaultName: z
        .string()
        .optional()
        .describe('Human-readable vault name (e.g. "Aave USDC Vault").'),
      chainId: z
        .number()
        .int()
        .describe('Chain ID where the vault is deployed.'),
      network: z
        .string()
        .optional()
        .describe('Chain name (e.g. "Base", "Ethereum").'),
      protocolName: z
        .string()
        .optional()
        .describe('Protocol name (e.g. "Aave", "Morpho").'),
      tokenSymbol: z
        .string()
        .optional()
        .describe('Token deposited (e.g. "USDC").'),
      tokenAddress: z
        .string()
        .optional()
        .describe('Token contract address (0x...).'),
      amount: z
        .string()
        .describe('Human-readable deposit amount (e.g. "100" for 100 USDC).'),
      amountRaw: z
        .string()
        .describe('Raw deposit amount in smallest unit (e.g. "100000000" for 100 USDC with 6 decimals).'),
      txHash: z
        .string()
        .describe('Confirmed deposit transaction hash (0x...).'),
    },
    async ({
      walletAddress,
      vaultAddress,
      vaultName,
      chainId,
      network,
      protocolName,
      tokenSymbol,
      tokenAddress,
      amount,
      amountRaw,
      txHash,
    }) => {
      const body: Record<string, unknown> = {
        userAddress: walletAddress,
        vaultAddress,
        chainId,
        amount,
        amountRaw,
        txHash,
        action: 'deposit',
      };
      if (vaultName) body.vaultName = vaultName;
      if (network) body.network = network;
      if (protocolName) body.protocolName = protocolName;
      if (tokenSymbol) body.tokenSymbol = tokenSymbol;
      if (tokenAddress) body.tokenAddress = tokenAddress;

      const result = await hopfastFetch<unknown>('/api/earn/positions', {
        method: 'POST',
        body: JSON.stringify(body),
      });

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    },
  );

  // ─── get_user_preferences ─────────────────────────────────────────────────
  server.tool(
    'get_user_preferences',
    `Fetch a user's saved yield preferences from HopFast.
Returns riskAppetite ("high" | "safe"), preferredAsset, and experienceLevel.
Returns null if the user has not set preferences yet.

Use this before recommending vaults to personalise suggestions.`,
    {
      walletAddress: z
        .string()
        .describe("User's wallet address (0x...)."),
    },
    async ({ walletAddress }) => {
      const result = await hopfastFetch<{
        preference: {
          riskAppetite: string;
          preferredAsset: string;
          experienceLevel: string;
        } | null;
      }>(`/api/earn/preferences/${walletAddress}`);

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    },
  );

  // ─── save_user_preferences ────────────────────────────────────────────────
  server.tool(
    'save_user_preferences',
    `Save or update a user's yield preferences in HopFast.
These preferences are used to personalise vault recommendations.

- riskAppetite: "high" (chase APY, accept volatility) or "safe" (stable assets, lower risk)
- preferredAsset: token symbol they prefer to earn in (e.g. "USDC", "ETH"), or "any"
- experienceLevel: "beginner" | "intermediate" | "advanced"`,
    {
      walletAddress: z
        .string()
        .describe("User's wallet address (0x...)."),
      riskAppetite: z
        .enum(['high', 'safe'])
        .describe('"high" for aggressive yield hunting or "safe" for stable/conservative vaults.'),
      preferredAsset: z
        .string()
        .optional()
        .describe('Token symbol preference ("USDC", "ETH", "any"). Defaults to "any".'),
      experienceLevel: z
        .enum(['beginner', 'intermediate', 'advanced'])
        .describe("User's DeFi experience level."),
    },
    async ({ walletAddress, riskAppetite, preferredAsset, experienceLevel }) => {
      const body: Record<string, unknown> = {
        userAddress: walletAddress,
        riskAppetite,
        experienceLevel,
      };
      if (preferredAsset) body.preferredAsset = preferredAsset;

      const result = await hopfastFetch<unknown>('/api/earn/preferences', {
        method: 'POST',
        body: JSON.stringify(body),
      });

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    },
  );
}
