/**
 * MCP Prompts — pre-built agent workflows that guide multi-step DeFi operations
 *
 * These are templates an agent or user can invoke to get a structured, step-by-step
 * prompt for completing common HopFast tasks.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

export function registerPrompts(server: McpServer): void {
  // ─── cross_chain_swap ──────────────────────────────────────────────────────
  server.prompt(
    'cross_chain_swap',
    'Generate a step-by-step plan to execute a cross-chain token swap on HopFast',
    {
      walletAddress: z.string().describe("User's wallet address."),
      fromChain: z.string().describe('Source chain (e.g. "ethereum", "base").'),
      toChain: z.string().describe('Destination chain (e.g. "polygon", "bsc").'),
      fromToken: z.string().describe('Token to swap from (symbol, e.g. "USDC").'),
      toToken: z.string().describe('Token to swap to (symbol, e.g. "ETH").'),
      amount: z.string().describe('Human-readable amount (e.g. "100" for 100 USDC).'),
    },
    ({ walletAddress, fromChain, toChain, fromToken, toToken, amount }) => ({
      messages: [
        {
          role: 'user',
          content: {
            type: 'text',
            text: `I want to swap ${amount} ${fromToken} on ${fromChain} to ${toToken} on ${toChain}.
My wallet address is ${walletAddress}.

Please help me execute this cross-chain swap on HopFast by:
1. First registering my wallet with HopFast.
2. Getting a swap quote (try LI.FI first, then Squid, then deBridge if needed).
3. Showing me the quote details: destination amount, fees in USD, and estimated completion time.
4. Confirming I want to proceed before giving me the transaction to sign.
5. After I confirm, provide the transaction payload for my wallet to sign.
6. Recording the transaction and monitoring its status until it completes.

Remember:
- Convert ${amount} ${fromToken} to wei before calling get_swap_quote.
- Use the correct token contract address for ${fromToken} on ${fromChain} and ${toToken} on ${toChain}.
  (Read hopfast://chains resource if you need addresses.)
- Do NOT submit the transaction yourself — I will sign it with my wallet.`,
          },
        },
      ],
    }),
  );

  // ─── find_yield ────────────────────────────────────────────────────────────
  server.prompt(
    'find_yield',
    'Help a user discover and deposit into the best yield vault for their assets',
    {
      walletAddress: z.string().describe("User's wallet address."),
      asset: z.string().optional().describe('Token to earn yield on (e.g. "USDC", "ETH"). Omit to explore all.'),
      chainKey: z.string().optional().describe('Preferred chain (e.g. "base", "ethereum"). Omit for all chains.'),
    },
    ({ walletAddress, asset, chainKey }) => ({
      messages: [
        {
          role: 'user',
          content: {
            type: 'text',
            text: `I want to earn yield on HopFast.
My wallet address is ${walletAddress}.
${asset ? `I want to earn on ${asset}.` : 'I am open to any asset.'}
${chainKey ? `Preferred chain: ${chainKey}.` : 'Any chain is fine.'}

Please help me by:
1. Checking my existing yield preferences with get_user_preferences.
   - If I have no preferences yet, ask me about my risk appetite (high/safe) and experience level,
     then save them with save_user_preferences.
2. Browsing available vaults with get_earn_vaults using my preferences.
3. Recommending the top 3 vaults sorted by APY, showing:
   - Protocol name, vault name, token, APY %, TVL in USD, chain
4. Once I pick a vault, get a deposit quote with get_earn_quote.
5. Show me: fees, estimated time, and how many vault tokens I'll receive.
6. After I confirm and sign the deposit transaction, record it with record_earn_deposit.

Do not proceed past step 4 without my explicit approval.`,
          },
        },
      ],
    }),
  );

  // ─── portfolio_review ──────────────────────────────────────────────────────
  server.prompt(
    'portfolio_review',
    "Review a user's complete HopFast DeFi portfolio: swap history and earn positions",
    {
      walletAddress: z.string().describe("User's wallet address."),
    },
    ({ walletAddress }) => ({
      messages: [
        {
          role: 'user',
          content: {
            type: 'text',
            text: `Please give me a complete portfolio review for wallet ${walletAddress} on HopFast.

1. Fetch my transaction history with get_transaction_history (last 20 swaps).
2. Fetch my active earn positions with get_earn_positions.
3. Summarise:
   - Total swaps completed and approximate volume
   - Active vault positions: protocol, token, amount, chain
   - Any pending/in-progress transactions
4. Highlight any interesting patterns or opportunities (e.g. "You've been swapping USDC
   frequently — consider putting some in a USDC vault on Base for yield").`,
          },
        },
      ],
    }),
  );

  // ─── check_swap_status ────────────────────────────────────────────────────
  server.prompt(
    'check_swap_status',
    'Monitor a pending cross-chain swap until it completes or fails',
    {
      txHash: z.string().describe('Transaction hash to monitor.'),
      provider: z.string().describe('Provider used (lifi | squid | debridge).'),
      fromChain: z.string().describe('Source chain key.'),
      toChain: z.string().describe('Destination chain key.'),
    },
    ({ txHash, provider, fromChain, toChain }) => ({
      messages: [
        {
          role: 'user',
          content: {
            type: 'text',
            text: `Please monitor this cross-chain swap until it completes or fails:

- Transaction hash: ${txHash}
- Provider: ${provider}
- From chain: ${fromChain}
- To chain: ${toChain}

Use get_transaction_status to check the status.
- If status is "completed": tell me the receiving transaction hash and explorer link.
- If status is "failed": explain what happened.
- If status is "confirming" or "bridging": keep checking every 20 seconds and give me updates.
- Stop after 20 attempts (roughly 7 minutes) if it hasn't resolved.`,
          },
        },
      ],
    }),
  );
}
