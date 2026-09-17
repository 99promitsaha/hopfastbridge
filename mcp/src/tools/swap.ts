/**
 * Swap tools — cross-chain quote, status, and transaction history
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { hopfastFetch } from '../client.js';

const CHAIN_KEYS = ['ethereum', 'base', 'bsc', 'polygon', 'monad'] as const;
const PROVIDERS = ['lifi', 'squid', 'debridge'] as const;

export function registerSwapTools(server: McpServer): void {
  // ─── get_swap_quote ────────────────────────────────────────────────────────
  server.tool(
    'get_swap_quote',
    `Get a cross-chain swap quote from one of HopFast's three routing providers
(LI.FI, Squid Router, or deBridge). Returns the estimated destination amount,
total fees, estimated duration, and a ready-to-sign transaction request.

Supported chains: ethereum (1), base (8453), bsc (56), polygon (137), monad (143).

IMPORTANT: amounts must be in the smallest token unit (wei/satoshi).
For example, 1 USDC on Base = "1000000" (6 decimals).
For 1 ETH = "1000000000000000000" (18 decimals).

Token addresses must be the EVM contract address (0x...).
Use the native token address 0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE for
chain-native assets like ETH, BNB, POL, MON.`,
    {
      fromChain: z
        .enum(CHAIN_KEYS)
        .describe('Source chain key: ethereum | base | bsc | polygon | monad'),
      toChain: z
        .enum(CHAIN_KEYS)
        .describe('Destination chain key: ethereum | base | bsc | polygon | monad'),
      fromToken: z
        .string()
        .describe('Source token contract address (0x...). Use 0xEeee...EEeE for native.'),
      toToken: z
        .string()
        .describe('Destination token contract address (0x...). Use 0xEeee...EEeE for native.'),
      amount: z
        .string()
        .describe('Amount to swap in smallest token unit (e.g. "1000000" for 1 USDC).'),
      walletAddress: z
        .string()
        .optional()
        .describe('Sender wallet address (0x...). Required for executable transaction data.'),
      provider: z
        .enum(PROVIDERS)
        .optional()
        .describe('Preferred routing provider. Omit to let HopFast choose (defaults to lifi).'),
    },
    async ({ fromChain, toChain, fromToken, toToken, amount, walletAddress, provider }) => {
      const query = new URLSearchParams({ provider: provider ?? 'lifi' });

      const body: Record<string, unknown> = {
        srcChainKey: fromChain,
        dstChainKey: toChain,
        srcTokenAddress: fromToken,
        dstTokenAddress: toToken,
        amount,
      };
      if (walletAddress) body.srcWalletAddress = walletAddress;

      const result = await hopfastFetch<{ provider: string; quotes: unknown[] }>(
        `/api/quotes?${query}`,
        { method: 'POST', body: JSON.stringify(body) },
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

  // ─── get_transaction_status ────────────────────────────────────────────────
  server.tool(
    'get_transaction_status',
    `Poll the status of a submitted cross-chain swap or bridge transaction.

Possible statuses returned:
- "submitted"   — tx is in the mempool, not yet confirmed
- "confirming"  — tx confirmed on source chain, bridge in progress
- "bridging"    — assets are crossing chains
- "completed"   — funds arrived on destination chain ✓
- "failed"      — tx reverted or bridge failed

Call this tool repeatedly (every 10–30 seconds) until status is "completed" or "failed".
The response also includes receivingTxHash (destination chain tx) and explorerLink.`,
    {
      txHash: z.string().describe('Transaction hash from the source chain (0x...).'),
      provider: z
        .enum(PROVIDERS)
        .describe('The provider used to submit this transaction (lifi | squid | debridge).'),
      fromChain: z
        .enum(CHAIN_KEYS)
        .describe('Source chain key used in the original swap.'),
      toChain: z
        .enum(CHAIN_KEYS)
        .describe('Destination chain key used in the original swap.'),
    },
    async ({ txHash, provider, fromChain, toChain }) => {
      const query = new URLSearchParams({
        txHash,
        provider,
        fromChain,
        toChain,
      });

      const result = await hopfastFetch<{
        status: string;
        substatus?: string;
        receivingTxHash?: string;
        explorerLink?: string;
      }>(`/api/status?${query}`);

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

  // ─── get_transaction_history ───────────────────────────────────────────────
  server.tool(
    'get_transaction_history',
    `Retrieve a wallet's swap and bridge transaction history stored in HopFast.
Returns the most recent transactions first, including status, chains, tokens, amounts, and tx hashes.`,
    {
      walletAddress: z
        .string()
        .describe("User's wallet address (0x...)."),
      limit: z
        .number()
        .int()
        .min(1)
        .max(100)
        .optional()
        .describe('Max records to return (1–100, default 20).'),
    },
    async ({ walletAddress, limit }) => {
      const query = new URLSearchParams({ userAddress: walletAddress });
      if (limit) query.set('limit', String(limit));

      const result = await hopfastFetch<{ count: number; records: unknown[] }>(
        `/api/transactions?${query}`,
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

  // ─── record_transaction ────────────────────────────────────────────────────
  server.tool(
    'record_transaction',
    `Save a submitted swap transaction to the HopFast database so it appears in
the user's history and can be tracked. Call this immediately after a user signs
and broadcasts a swap transaction.`,
    {
      walletAddress: z
        .string()
        .describe("User's wallet address (0x...)."),
      txHash: z
        .string()
        .describe('On-chain transaction hash (0x...).'),
      fromChain: z.enum(CHAIN_KEYS).describe('Source chain key.'),
      toChain: z.enum(CHAIN_KEYS).describe('Destination chain key.'),
      fromToken: z.string().describe('Source token symbol (e.g. "USDC", "ETH").'),
      toToken: z.string().describe('Destination token symbol.'),
      amount: z.string().describe('Human-readable amount sent (e.g. "100" for 100 USDC).'),
      provider: z
        .enum(PROVIDERS)
        .optional()
        .describe('Routing provider used (lifi | squid | debridge).'),
      volumeUsd: z
        .number()
        .optional()
        .describe('USD value of the swap at time of execution.'),
      status: z
        .string()
        .optional()
        .describe('Initial status (default: "submitted").'),
    },
    async ({
      walletAddress,
      txHash,
      fromChain,
      toChain,
      fromToken,
      toToken,
      amount,
      provider,
      volumeUsd,
      status,
    }) => {
      const body: Record<string, unknown> = {
        userAddress: walletAddress,
        txHash,
        fromChain,
        toChain,
        fromTokenSymbol: fromToken,
        toTokenSymbol: toToken,
        amount,
      };
      if (provider) body.provider = provider;
      if (volumeUsd !== undefined) body.volumeUsd = volumeUsd;
      if (status) body.status = status;

      const result = await hopfastFetch<unknown>('/api/transactions', {
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
