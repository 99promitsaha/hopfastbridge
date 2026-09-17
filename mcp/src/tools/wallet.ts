/**
 * Wallet tools — registration and health checks
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { hopfastFetch } from '../client.js';

export function registerWalletTools(server: McpServer): void {
  // ─── register_wallet ───────────────────────────────────────────────────────
  server.tool(
    'register_wallet',
    `Register a wallet address with HopFast. This creates or updates the wallet
record in the database and updates its last-seen timestamp.

Call this at the start of any session where you have the user's wallet address.
It's safe to call multiple times — it's idempotent (upsert).`,
    {
      walletAddress: z
        .string()
        .describe("User's EVM wallet address (0x..., checksummed or lowercase)."),
    },
    async ({ walletAddress }) => {
      const result = await hopfastFetch<unknown>('/api/wallets', {
        method: 'POST',
        body: JSON.stringify({ address: walletAddress }),
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

  // ─── get_protocol_stats ────────────────────────────────────────────────────
  server.tool(
    'get_protocol_stats',
    `Get aggregated HopFast protocol statistics for a given time period.
Returns:
- uniqueUsers: number of distinct wallets that used HopFast
- swapVolumeUsd: total USD value of swaps executed
- swapCount: total number of swap transactions
- earnDepositCount: number of vault deposits
- earnDepositsByToken: breakdown of deposits by token symbol
- protocolFeeUsd: protocol fees collected

Use for reporting, analytics, or when users ask about HopFast's activity.`,
    {
      period: z
        .enum(['7d', '15d', '30d'])
        .optional()
        .describe('Statistics time window (7d | 15d | 30d). Default: 7d.'),
    },
    async ({ period }) => {
      const query = new URLSearchParams({ period: period ?? '7d' });
      const result = await hopfastFetch<unknown>(`/api/stats?${query}`);

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

  // ─── check_health ──────────────────────────────────────────────────────────
  server.tool(
    'check_health',
    `Check if the HopFast backend is online and the database is connected.
Returns service status and database connection status.
Use this to verify connectivity before attempting other operations.`,
    {},
    async () => {
      const result = await hopfastFetch<{ ok: boolean; service: string; db: string }>(
        '/api/health',
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
}
